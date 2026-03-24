"""
Azure Speech VO generator for video projects.
Uses Dragon HD voice with rate adjustment and deterministic output.

Usage:
  1. Edit SECTIONS dict with your script sections
  2. Run: python3 generate-vo.py
  3. WAV files output to ./vo/ directory

Config notes:
  - Dragon HD does NOT support <prosody pitch>. It silently produces clicking artifacts.
  - rate="+10%" works and produces audibly faster speech.
  - temperature=0 on the voice element gives deterministic, consistent output.
    Higher values (up to 2.0) add expressiveness but also non-deterministic variation.
  - Punctuation is the real energy lever: ! for energy, -- for dramatic pauses, ? for rising intonation.
  - Always output 48kHz (Riff48Khz16BitMonoPcm). 24kHz can sound garbled.
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
# Edit this dict. Keys become filenames, values are the text to speak.
# For a single full-video VO, use one key. For multi-section, use multiple.
SECTIONS = {
    "full-vo": """Your script here.""",
}


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
    for name, text in SECTIONS.items():
        generate(name, text)
    print("\nDone! Files in:", OUTPUT_DIR)
