"""
Azure Speech VO generator for video projects.
Uses Dragon HD voice with rate adjustment and deterministic output.

Usage:
  1. Edit SENTENCES list with your script — one entry per sentence
  2. Run: python3 generate-vo.py
  3. Individual WAV files output to ./vo/ directory

Config notes:
  - Dragon HD does NOT support <prosody pitch>. It silently produces clicking artifacts.
  - rate="+10%" works and produces audibly faster speech. Do NOT add pitch.
  - temperature=0 on the voice element gives deterministic, consistent output.
    Higher values (up to 2.0) add expressiveness but also non-deterministic variation.
  - Punctuation is the real energy lever: ! for energy, — for dramatic pauses, ? for
    rising intonation. Dragon HD's LLM backbone reads emotion from punctuation and text.
  - Always output 48kHz (Riff48Khz16BitMonoPcm). 24kHz can sound garbled.
  - CRITICAL: Generate each sentence as a SEPARATE file. Long single-file generations
    (25+ sentences) produce clicking/popping artifacts even without pitch. Short
    individual sentences are consistently clean. This also gives you individual files
    for precise timeline placement.
"""

import azure.cognitiveservices.speech as speechsdk
import os

# --- CONFIG ---
SPEECH_KEY = os.environ.get("AZURE_SPEECH_KEY", "YOUR_KEY_HERE")
SPEECH_REGION = os.environ.get("AZURE_SPEECH_REGION", "eastus")
VOICE = "en-US-Andrew:DragonHDLatestNeural"
RATE = "+10%"
TEMPERATURE = "0"

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "vo")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# --- SCRIPT ---
# One tuple per sentence: ("filename", "text to speak")
# Use ! for energy, — for dramatic pauses, ? for rising intonation.
SENTENCES = [
    ("01-example", "Your script here!"),
]


def generate(name: str, text: str):
    output_path = os.path.join(OUTPUT_DIR, f"{name}.wav")
    print(f"Generating {name}...", end=" ", flush=True)

    config = speechsdk.SpeechConfig(subscription=SPEECH_KEY, region=SPEECH_REGION)
    config.set_speech_synthesis_output_format(
        speechsdk.SpeechSynthesisOutputFormat.Riff48Khz16BitMonoPcm
    )
    audio_config = speechsdk.audio.AudioOutputConfig(filename=output_path)
    synthesizer = speechsdk.SpeechSynthesizer(
        speech_config=config, audio_config=audio_config
    )

    ssml = f'''<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
<voice name="{VOICE}" parameters="temperature={TEMPERATURE}">
<prosody rate="{RATE}">{text.strip()}</prosody>
</voice></speak>'''

    result = synthesizer.speak_ssml_async(ssml).get()

    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        dur = os.popen(
            f'ffprobe -v error -show_entries format=duration '
            f'-of default=noprint_wrappers=1:nokey=1 "{output_path}"'
        ).read().strip()
        print(f"OK ({dur}s)")
    elif result.reason == speechsdk.ResultReason.Canceled:
        details = result.cancellation_details
        print(f"FAILED: {details.reason} — {details.error_details}")


if __name__ == "__main__":
    for name, text in SENTENCES:
        generate(name, text)
    print("\nDone! Files in:", OUTPUT_DIR)
