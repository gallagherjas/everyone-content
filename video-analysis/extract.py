#!/usr/bin/env python3
"""从抖音作品或本地视频提取按时间排列的截图。"""
import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from douyin import download, is_douyin


def extract(video, output, interval):
    if not math.isfinite(interval) or not 0.2 <= interval <= 3600:
        raise ValueError("抽帧间隔应为 0.2 到 3600 秒")
    if output.exists():
        raise ValueError(f"输出目录已存在：{output}")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("未找到 FFmpeg，请先安装 FFmpeg")

    with tempfile.TemporaryDirectory(prefix="everyone-video-") as temporary:
        temporary = Path(temporary)
        if is_douyin(video):
            print("正在下载抖音视频…", flush=True)
            media = temporary / "source.mp4"
            download(video, media)
        else:
            media = Path(video).expanduser().resolve()
            if not media.is_file():
                raise ValueError(f"找不到本地视频：{media}")

        print(f"每 {interval:g} 秒抽取一帧…", flush=True)
        result = temporary / "result"
        frames_dir = result / "frames"
        frames_dir.mkdir(parents=True)
        subprocess.run([ffmpeg, "-v", "error", "-i", str(media), "-vf",
                        f"fps=1/{interval}:start_time=0,scale=w='min(720,iw)':h=-2",
                        "-q:v", "3", str(frames_dir / "frame-%05d.jpg")], check=True)
        frames = sorted(frames_dir.glob("frame-*.jpg"))
        if not frames:
            raise ValueError("视频没有可抽取的画面")
        subprocess.run([ffmpeg, "-v", "error", "-framerate", "1", "-i",
                        str(frames_dir / "frame-%05d.jpg"), "-vf", "scale=300:-2,tile=4x4",
                        "-fps_mode", "vfr", str(result / "sheet-%03d.jpg")], check=True)
        sheets = sorted(result.glob("sheet-*.jpg"))
        metadata = {
            "source": video,
            "interval_seconds": interval,
            "frames": [{"file": f"frames/{frame.name}", "time_seconds": round(i * interval, 6)}
                       for i, frame in enumerate(frames)],
            "sheets": [sheet.name for sheet in sheets],
        }
        (result / "index.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(result, output)
    return len(frames), len(sheets)


def main():
    parser = argparse.ArgumentParser(description="将抖音作品链接或本地视频转换为截图")
    parser.add_argument("video", help="抖音作品链接或本地视频路径")
    parser.add_argument("--interval", type=float, default=0.5, help="抽帧间隔（秒），默认 0.5")
    parser.add_argument("--output", type=Path, required=True, help="保存结果的新目录")
    args = parser.parse_args()
    try:
        frames, sheets = extract(args.video, args.output.expanduser(), args.interval)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"截图失败：{error}\n")
    print(f"生成 {frames} 张单帧和 {sheets} 张拼图：{args.output}")


if __name__ == "__main__":
    main()
