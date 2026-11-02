import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Voice-over for audit videos with the text-to-speech voices built into Windows (free, offline):
 * Microsoft Zira (female) or David (male). Each line is spoken to a 48 kHz mono WAV file, read
 * back as 16-bit samples. On other systems there is no voice and the video stays silent.
 */

export type Voice = "female" | "male" | "none";
export const SAMPLE_RATE = 48_000;
const VOICES: Record<Exclude<Voice, "none">, string> = { female: "Microsoft Zira Desktop", male: "Microsoft David Desktop" };
const run = promisify(execFile);

const SCRIPT = `param([string]$Json, [string]$Voice)
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 -Path $Json | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice($Voice) } catch { }
$s.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($i in $items) { $s.SetOutputToWaveFile($i.file, $fmt); $s.Speak([string]$i.text) }
$s.SetOutputToNull()
$s.Dispose()
`;

/** Text a speech engine reads well: no links, symbols or code. */
export function speakable(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&/g, " and ")
    .replace(/[`*_#|~^{}[\]\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The 16-bit samples of a PCM WAV file. */
export function wavSamples(buf: Buffer): Int16Array {
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") {
      const data = buf.subarray(at + 8, at + 8 + size);
      return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + (data.length & ~1)));
    }
    at += 8 + size + (size & 1);
  }
  return new Int16Array(0);
}

/** Speaks each line; returns the samples per line, or null when no voice is available. */
export async function speakLines(lines: string[], voice: Voice): Promise<Int16Array[] | null> {
  if (voice === "none" || process.platform !== "win32" || !lines.length) return null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "leadlift-voice-"));
  try {
    const items = lines.map((text, i) => ({ text: speakable(text) || ".", file: path.join(dir, `${i}.wav`) }));
    const json = path.join(dir, "lines.json");
    const ps1 = path.join(dir, "speak.ps1");
    await fs.writeFile(json, JSON.stringify(items), "utf8");
    await fs.writeFile(ps1, SCRIPT, "utf8");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Json", json, "-Voice", VOICES[voice]], { windowsHide: true, timeout: 600_000 });
    return await Promise.all(items.map(async (i) => wavSamples(await fs.readFile(i.file))));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
