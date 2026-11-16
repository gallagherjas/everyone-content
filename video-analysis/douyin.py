"""从抖音作品链接获取视频。"""
import json
import re
import shutil
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen


USER_AGENT = ("Mozilla/5.0 (Linux; Android 13; 2210132C Build/TKQ1.220829.002) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36")


def is_douyin(url):
    host = (urlsplit(url).hostname or "").lower()
    return host in ("douyin.com", "iesdouyin.com") or host.endswith((".douyin.com", ".iesdouyin.com"))


def video_id(url):
    parsed = urlsplit(url)
    match = re.search(r"/video/(\d{16,20})", parsed.path)
    if match:
        return match.group(1)
    candidate = parse_qs(parsed.query).get("modal_id", [""])[0]
    return candidate if re.fullmatch(r"\d{16,20}", candidate) else None


def download(url, target):
    item_id = video_id(url)
    if not item_id and urlsplit(url).hostname == "v.douyin.com":
        with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=20) as response:
            resolved = response.geturl()
        if is_douyin(resolved):
            item_id = video_id(resolved)
    if not item_id:
        raise ValueError("无法从抖音链接提取作品编号")
    query = urlencode({"aweme_id": item_id, "aid": "6383", "device_platform": "web",
                       "version_code": "190500", "version_name": "19.5.0"})
    request = Request("https://api.amemv.com/aweme/v1/aweme/detail/?" + query,
                      headers={"User-Agent": USER_AGENT, "Accept": "application/json, text/plain, */*"})
    with urlopen(request, timeout=20) as response:
        data = json.load(response)
    detail = data.get("aweme_detail") or {}
    if data.get("status_code") != 0 or str(detail.get("aweme_id")) != item_id:
        raise ValueError(f"抖音未返回对应作品详情（状态 {data.get('status_code')}）")
    urls = detail.get("video", {}).get("play_addr", {}).get("url_list", [])
    if not urls:
        raise ValueError("作品详情中没有视频播放地址")
    last_error = None
    for media_url in urls:
        try:
            request = Request(media_url, headers={"User-Agent": USER_AGENT, "Referer": "https://www.douyin.com/"})
            with urlopen(request, timeout=30) as response, target.open("wb") as output:
                shutil.copyfileobj(response, output)
            return
        except (OSError, ValueError) as error:
            last_error = error
    raise RuntimeError(f"无法下载作品媒体：{last_error}")
