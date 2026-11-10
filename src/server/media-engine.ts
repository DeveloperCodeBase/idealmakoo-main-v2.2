import type {VideoProfile} from '../types/media-processing';
interface RawProbeStream {codec_type?:string;codec_name?:string;width?:unknown;height?:unknown;r_frame_rate?:string;channels?:unknown;sample_rate?:unknown}
interface RawProbe {streams:RawProbeStream[];format?:{duration?:unknown}}
export type MediaProbe=Awaited<ReturnType<typeof probeLocalVideo>>;
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert, HttpError } from "./types";
import { access, mkdtemp, stat, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
const MEDIA_LIMITS = { inputBytes: 80 * 1024 * 1024, outputBytes: 64 * 1024 * 1024, durationSeconds: 600, maximumWidth: 3840, maximumHeight: 2160, framesPerSecond: 60, subtitleBytes: 262144, subtitleCues: 1e3 };
const ffmpeg = "/usr/bin/ffmpeg", ffprobe = "/usr/bin/ffprobe";
function processingTimeout() { const value = process.env.MEDIA_PROCESSING_TIMEOUT_SECONDS || "120"; (assert)(/^\d+$/.test(value) && Number(value) >= 30 && Number(value) <= 300, 503, "MEDIA_PROCESSING_CONFIG", "Media processing timeout must be between30 and300 seconds."); return Number(value); }
async function mediaEngineAvailable() {
    try {
        await Promise.all([(access)(ffmpeg, constants.X_OK), (access)(ffprobe, constants.X_OK)]);
        return true;
    }
    catch {
        return false;
    }
}
async function command(binary: string, args: string[], timeoutMs: number, signal?: AbortSignal) : Promise<string> {
    (assert)(!signal?.aborted, 409, "MEDIA_JOB_CANCELLED", "Media processing was cancelled.");
    return new Promise<string>((resolve, reject) => {
        let settled = false, output = Buffer.alloc(0), failure: Error | null = null;
        const child = (spawn)(binary, args, { shell: false, stdio: ["ignore", "pipe", "ignore"], env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_ENV: "production" } });
        const fail = (error: Error) => { failure = error; child.kill("SIGKILL"); };
        const timer = setTimeout(() => fail(new HttpError(503, "MEDIA_PROCESSING_TIMEOUT", "The bounded local media processing time was exceeded.")), timeoutMs);
        const cancel = () => fail(new HttpError(409, "MEDIA_JOB_CANCELLED", "Media processing was cancelled."));
        signal?.addEventListener("abort", cancel, { once: true });
        const finish = (error?: Error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", cancel);
            if (error)
                reject(error);
            else
                resolve(output.toString("utf8"));
        };
        child.on("error", () => finish(new HttpError(503, "MEDIA_ENGINE_UNAVAILABLE", "The local media processing engine could not be started.")));
        child.stdout.on("data", chunk => {
            if (output.length + chunk.length > 65536)
                fail(new HttpError(422, "MEDIA_PROBE_LIMIT", "The media metadata exceeded its bounded size."));
            else
                output = Buffer.concat([output, chunk]);
        });
        child.on("close", code => finish(failure || (code === 0 ? void 0 : new HttpError(422, "MEDIA_DECODE_FAILED", "The file could not be safely decoded by the local media engine."))));
    });
}
const inputOptions = ["-hide_banner", "-loglevel", "error", "-max_alloc", "67108864", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov", "-f", "mov", "-enable_drefs", "0", "-use_absolute_path", "0"];
async function probeLocalVideo(path: string, signal?: AbortSignal) {
    let value: RawProbe;
    try {
        value = JSON.parse(await command(ffprobe, [...inputOptions, "-threads", "1", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate", "-of", "json", path], 1e4, signal));
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(422, "MEDIA_PROBE_INVALID", "The local media metadata was invalid.");
    }
    const object = value;
    (assert)(Array.isArray(object.streams) && object.streams.length >= 1 && object.streams.length <= 8, 422, "MEDIA_STREAM_LIMIT", "The media stream count is unsupported.");
    const videos = object.streams.filter(item => item.codec_type === "video"), audios = object.streams.filter(item => item.codec_type === "audio");
    (assert)(videos.length === 1 && audios.length <= 1, 422, "MEDIA_STREAM_LIMIT", "Use one video stream and at most one audio stream.");
    const video = videos[0], audio = audios[0];
    const duration = Number(object.format?.duration), width = Number(video.width), height = Number(video.height), rate = (video.r_frame_rate || "").split("/").map(Number), fps = rate.length === 2 ? rate[0] / rate[1] : rate[0];
    (assert)(Number.isFinite(duration) && duration > 0 && duration <= MEDIA_LIMITS.durationSeconds, 422, "MEDIA_DURATION", "The video duration is unsupported or exceeds10 minutes.");
    (assert)(Number.isInteger(width) && Number.isInteger(height) && width >= 2 && height >= 2 && width <= MEDIA_LIMITS.maximumWidth && height <= MEDIA_LIMITS.maximumHeight, 422, "MEDIA_DIMENSIONS", "The video must fit within3840 by2160 pixels.");
    (assert)(Number.isFinite(fps) && fps > 0 && fps <= MEDIA_LIMITS.framesPerSecond, 422, "MEDIA_FRAMERATE", "The video must use at most60 frames per second.");
    (assert)(!audio || Number(audio.channels) <= 8 && Number(audio.sample_rate) <= 192e3, 422, "MEDIA_AUDIO_LIMIT", "The audio stream exceeds the supported channel or sample-rate limits.");
    return { width, height, durationSeconds: duration, framesPerSecond: fps, videoCodec: String(video.codec_name || "unknown").slice(0, 80), audioCodec: audio ? String(audio.codec_name || "unknown").slice(0, 80) : null };
}
async function transcodeLocalVideo(path: string, profile: VideoProfile, source: MediaProbe, signal?: AbortSignal) {
    const directory = await (mkdtemp)((join)((tmpdir)(), "idealmakoo-video-"));
    const output = (join)(directory, "derived.mp4"), dimensions = profile === "web_480p" ? { width: 854, height: 480 } : { width: 1280, height: 720 };
    try {
        await command(ffmpeg, ["-nostdin", ...inputOptions, "-threads", "2", "-i", path, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-filter_threads", "1", "-vf", `scale=w='min(${dimensions.width},iw)':h='min(${dimensions.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "2", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k", "-max_muxing_queue_size", "1024", "-fs", String(MEDIA_LIMITS.outputBytes), "-movflags", "+faststart", "-f", "mp4", output], processingTimeout() * 1e3, signal);
        const size = (await (stat)(output)).size;
        (assert)(size > 0 && size < MEDIA_LIMITS.outputBytes, 413, "MEDIA_OUTPUT_LIMIT", "The encoded output reached its size limit; no partial video was published.");
        const measured = await probeLocalVideo(output, signal);
        (assert)(measured.width <= dimensions.width && measured.height <= dimensions.height && measured.videoCodec === "h264" && (!measured.audioCodec || measured.audioCodec === "aac"), 422, "MEDIA_OUTPUT_INVALID", "The encoded output does not match the requested fixed profile.");
        (assert)(Math.abs(measured.durationSeconds - source.durationSeconds) <= Math.max(1, source.durationSeconds * .01), 422, "MEDIA_OUTPUT_TRUNCATED", "The encoded output did not preserve the complete source duration.");
        return { bytes: await (readFile)(output), probe: measured };
    }
    finally {
        await (rm)(directory, { recursive: true, force: true });
    }
}
function timestamp(value: string) { const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value); (assert)(match && Number(match[2]) < 60 && Number(match[3]) < 60, 422, "SUBTITLE_TIME", "Use HH:MM:SS.mmm timestamps."); return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1e3; }
function sanitizeWebVtt(input: unknown, duration = MEDIA_LIMITS.durationSeconds) {
    (assert)(typeof input === "string" && Buffer.byteLength(input) <= MEDIA_LIMITS.subtitleBytes, 413, "SUBTITLE_SIZE", "The subtitle file exceeds256KiB.");
    const normalized = input.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").normalize("NFC");
    (assert)(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized), 422, "SUBTITLE_TEXT", "The subtitle text contains unsupported control characters.");
    const blocks = normalized.trim().split(/\n{2,}/);
    (assert)(blocks.shift() === "WEBVTT", 422, "SUBTITLE_HEADER", "The subtitle must start with WEBVTT and a blank line.");
    (assert)(blocks.length > 0 && blocks.length <= MEDIA_LIMITS.subtitleCues, 422, "SUBTITLE_CUES", "Use between1 and1000 subtitle cues.");
    let lastStart = -1, lastEnd = 0;
    const cues = [];
    for (const block of blocks) {
        const lines = block.split("\n");
        (assert)(!/^(STYLE|REGION|NOTE)(\s|$)/.test(lines[0]), 422, "SUBTITLE_BLOCK", "Only plain subtitle cues are supported.");
        let times = lines.shift()!;
        if (!times.includes("-->")) {
            (assert)(times.length <= 80 && !/[<>]/.test(times), 422, "SUBTITLE_ID", "The cue identifier is invalid.");
            times = lines.shift() || "";
        }
        const match = /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})$/.exec(times);
        (assert)(match, 422, "SUBTITLE_TIME", "Use a plain start --> end timestamp without positioning or styling.");
        const start = timestamp(match[1]), end = timestamp(match[2]);
        (assert)(start >= lastStart && end > start && end <= duration + .5, 422, "SUBTITLE_RANGE", "Subtitle cues must be ordered and remain within the video duration.");
        lastStart = start;
        lastEnd = Math.max(lastEnd, end);
        (assert)(lines.length >= 1 && lines.length <= 5 && lines.join("\n").length >= 1 && lines.join("\n").length <= 1e3 && !lines.some(line => line.includes("-->")), 422, "SUBTITLE_TEXT", "Each cue contains one to five bounded plain-text lines.");
        const text2 = lines.join("\n").replace(/[\u202a-\u202e\u2066-\u2069]/g, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        cues.push(`${cues.length + 1}
${match[1]} --> ${match[2]}
${text2}`);
    }
    const text = "WEBVTT\n\n" + cues.join("\n\n") + "\n";
    (assert)(Buffer.byteLength(text) <= MEDIA_LIMITS.subtitleBytes, 413, "SUBTITLE_SIZE", "The canonical subtitle exceeds256KiB.");
    return { text, cues: cues.length, lastEndSeconds: lastEnd };
}
export { MEDIA_LIMITS, mediaEngineAvailable, probeLocalVideo, processingTimeout, sanitizeWebVtt, transcodeLocalVideo };
