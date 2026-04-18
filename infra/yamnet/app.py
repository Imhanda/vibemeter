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

# Build index sets from class names — immune to index shifts across YAMNet versions.
MUSIC_CLASS_KEYWORDS = {
    "music", "singing", "song", "musical instrument", "guitar", "piano",
    "drum", "percussion", "bass", "pop music", "rock music", "rock and roll",
    "electronic music", "hip hop", "techno", "jazz", "reggae", "soul music",
    "exciting music", "happy music", "ska", "latin", "maraca", "rattle",
}
CROWD_CLASS_KEYWORDS = {
    "speech", "speaking", "conversation", "crowd", "hubbub", "chatter",
    "babbling", "narration", "children playing", "cheering", "laughter",
}

def _build_indices(class_names, keywords):
    return {
        i for i, name in enumerate(class_names)
        if any(kw in name.lower() for kw in keywords)
    }

MUSIC_INDICES = _build_indices(CLASS_NAMES, MUSIC_CLASS_KEYWORDS)
CROWD_INDICES = _build_indices(CLASS_NAMES, CROWD_CLASS_KEYWORDS)
log.info("Music indices (%d): %s", len(MUSIC_INDICES), sorted(MUSIC_INDICES))
log.info("Crowd indices (%d): %s", len(CROWD_INDICES), sorted(CROWD_INDICES))


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
    DB_FLOOR = -40.0             # cooler/AC hum (~-38 dBFS) sits near the floor
    DB_RANGE = 35.0              # 35 dB span: quiet home → loud club (-40 to -5)
    linear = (db - DB_FLOOR) / DB_RANGE
    linear = max(0.0, min(linear, 1.0))
    # Power curve (^2.5) compresses mid-range so phone AGC-amplified appliances
    # (cooler, AC, TV hum) don't score high. Only a genuinely loud venue
    # (bar, club) pushes the curve toward 1.0.
    #   cooler @ linear ~0.70  → ambient 0.70^2.5 ≈ 0.41
    #   busy pub @ linear ~0.85 → ambient 0.85^2.5 ≈ 0.66
    #   loud club @ linear ~0.95 → ambient 0.95^2.5 ≈ 0.88
    ambient = linear ** 2.5
    return float(ambient)


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

    # Log top 10 classes to help diagnose misclassification
    top10_idx = np.argsort(mean_scores)[::-1][:10]
    top10 = [(CLASS_NAMES[i], round(float(mean_scores[i]), 4)) for i in top10_idx]
    log.info("Top classes: %s", top10)

    signals = _group_scores(mean_scores, waveform)
    log.info("Analysed %d bytes → %s", len(audio_bytes), signals)

    return jsonify(signals)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082)
