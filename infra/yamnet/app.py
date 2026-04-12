"""
VibeMeter YAMNet audio analysis sidecar.

Accepts a multipart audio file (any format ffmpeg can decode),
runs Google's YAMNet model to classify sound, then returns the
three vibe signals expected by the Go backend:

  ambient_db    0-1  overall loudness relative to quiet baseline
  crowd_energy  0-1  confidence that crowd/speech is present
  music_energy  0-1  confidence that music is present

Audio is held in RAM only and discarded after analysis.
"""

import io
import logging
import subprocess
import tempfile
import os

import numpy as np
import requests
from flask import Flask, jsonify, request

import tensorflow as tf
import tensorflow_hub as hub

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("yamnet-sidecar")

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Load model once at startup
# ---------------------------------------------------------------------------
log.info("Loading YAMNet from TF Hub…")
MODEL = hub.load("https://tfhub.dev/google/yamnet/1")

# Load class names
CLASS_MAP_URL = (
    "https://raw.githubusercontent.com/tensorflow/models/master/"
    "research/audioset/yamnet/yamnet_class_map.csv"
)
_csv = requests.get(CLASS_MAP_URL, timeout=10).text.splitlines()
CLASS_NAMES = [row.split(",")[2].strip('"') for row in _csv[1:]]  # skip header
log.info("YAMNet ready — %d classes", len(CLASS_NAMES))

# AudioSet class indices we care about (stable across YAMNet versions)
MUSIC_INDICES = {
    137,  # Music
    138,  # Musical instrument
    139,  # Plucked string instrument
    140,  # Guitar
    151,  # Percussion
    153,  # Drum
    155,  # Bass drum
    160,  # Keyboard (musical)
    163,  # Piano
    64,   # Music of Africa
    68,   # Pop music
    71,   # Rock music
    80,   # Electronic music
    85,   # Hip hop music
    94,   # Techno
}
CROWD_INDICES = {
    0,    # Speech
    1,    # Male speech, man speaking
    2,    # Female speech, woman speaking
    3,    # Child speech, kid speaking
    4,    # Conversation
    5,    # Narration, monologue
    6,    # Babbling
    132,  # Crowd
    133,  # Hubbub, speech noise
    134,  # Children playing
}
NOISE_INDICES = {
    # Covers ambient / background hum
    494,  # White noise
    495,  # Pink noise
    496,  # Throbbing
    497,  # Hum
    498,  # Electronic hum
    40,   # Noise
    41,   # Environmental noise
}


def _decode_to_pcm(data: bytes) -> np.ndarray:
    """Convert any audio format to 16 kHz mono float32 via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_path,
                "-ac", "1",          # mono
                "-ar", "16000",      # 16 kHz (YAMNet requirement)
                "-f", "f32le",       # raw float32 little-endian
                "-",
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg error: {result.stderr.decode()[:200]}")
        return np.frombuffer(result.stdout, dtype=np.float32)
    finally:
        os.unlink(tmp_path)


def _group_scores(mean_scores: np.ndarray) -> dict:
    """
    Aggregate per-class scores into the three vibe signals.

    mean_scores: shape (521,) — average YAMNet score across all 0.96s frames.
    """
    music_energy = float(np.sum(mean_scores[[i for i in MUSIC_INDICES if i < len(mean_scores)]]))
    crowd_energy = float(np.sum(mean_scores[[i for i in CROWD_INDICES if i < len(mean_scores)]]))
    noise_raw    = float(np.sum(mean_scores[[i for i in NOISE_INDICES  if i < len(mean_scores)]]))

    # Ambient = overall acoustic busyness (everything that isn't silence)
    # Use the complement of silence class (index 494+ tends to be silence-adjacent).
    # Simpler: ambient is normalised total energy excluding top-3 silence classes.
    SILENCE_IDX = [494, 495, 496]
    ambient_db = float(1.0 - np.sum(mean_scores[[i for i in SILENCE_IDX if i < len(mean_scores)]]))
    ambient_db = max(0.0, min(ambient_db, 1.0))

    # Cap and normalise — YAMNet scores per-class sum approaches 1 across all classes
    # so per-group sums can exceed 1 when many related classes fire.
    music_energy = max(0.0, min(music_energy, 1.0))
    crowd_energy = max(0.0, min(crowd_energy, 1.0))

    return {
        "ambient_db": round(ambient_db, 4),
        "crowd_energy": round(crowd_energy, 4),
        "music_energy": round(music_energy, 4),
    }


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/analyse", methods=["POST"])
def analyse():
    if "audio" not in request.files:
        return jsonify({"error": "multipart field 'audio' required"}), 400

    audio_bytes = request.files["audio"].read()
    if len(audio_bytes) < 1024:
        return jsonify({"error": "audio file too small"}), 400

    try:
        waveform = _decode_to_pcm(audio_bytes)
    except Exception as e:
        log.warning("ffmpeg decode failed: %s", e)
        return jsonify({"error": "could not decode audio"}), 422

    if len(waveform) < 16000:  # less than 1 second
        return jsonify({"error": "audio too short (minimum 1 second)"}), 422

    # Run YAMNet — returns (scores, embeddings, spectrogram)
    scores, _, _ = MODEL(waveform)
    mean_scores = tf.reduce_mean(scores, axis=0).numpy()  # shape (521,)

    signals = _group_scores(mean_scores)
    log.info("Analysed %d bytes → %s", len(audio_bytes), signals)

    return jsonify(signals)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082)
