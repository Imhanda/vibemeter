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


def _rms_to_ambient(waveform: np.ndarray) -> float:
    """
    Compute ambient_db from raw waveform RMS energy.

    Using RMS instead of YAMNet classification scores because classification
    tells us *what* is playing, not *how loud* the room actually is.

    Phone mic dBFS calibration (float32 waveform, range -1.0 to +1.0):
      Quiet living room / library:  RMS dBFS ~ -45 to -38  → ambient ~0.05–0.25
      Busy restaurant / pub chat:   RMS dBFS ~ -28 to -18  → ambient ~0.35–0.60
      Loud bar / club floor:        RMS dBFS ~ -12 to  -5  → ambient ~0.75–1.00

    Floor = -50 dBFS, range = 45 dB — calibrated so a quiet home reads 0.0–0.2
    rather than saturating at 1.0.
    """
    rms = float(np.sqrt(np.mean(waveform ** 2)))
    if rms < 1e-9:
        return 0.0
    db = 20.0 * np.log10(rms)   # dBFS (negative; 0 = full scale)
    DB_FLOOR = -50.0             # quieter than this → near-zero ambient
    DB_RANGE = 45.0              # spans quiet room to loud club
    ambient = (db - DB_FLOOR) / DB_RANGE
    return float(max(0.0, min(ambient, 1.0)))


def _group_scores(mean_scores: np.ndarray, waveform: np.ndarray) -> dict:
    """
    Derive the three vibe signals from YAMNet classification scores and raw waveform.

    music_energy  — YAMNet music-class confidence (what fraction of frames had music)
    crowd_energy  — YAMNet speech/crowd-class confidence
    ambient_db    — RMS loudness of the room (independent of what's making the noise)
    """
    music_energy = float(np.sum(mean_scores[[i for i in MUSIC_INDICES if i < len(mean_scores)]]))
    crowd_energy = float(np.sum(mean_scores[[i for i in CROWD_INDICES if i < len(mean_scores)]]))

    # Cap — per-group sums can exceed 1 when many related classes fire simultaneously
    music_energy = max(0.0, min(music_energy, 1.0))
    crowd_energy = max(0.0, min(crowd_energy, 1.0))

    # ambient_db from RMS, not classification — avoids the "not silence = 100%" trap
    ambient_db = _rms_to_ambient(waveform)

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

    signals = _group_scores(mean_scores, waveform)
    log.info("Analysed %d bytes → %s", len(audio_bytes), signals)

    return jsonify(signals)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082)
