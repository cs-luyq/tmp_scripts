/*
  小红书无水印与解锁终极修复版 (点亮限制下载 + 视频/图片/LivePhoto无水印)
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

// 通用提取视频无水印播放流 (优先 h265 最高清，兜底 h264)
function getCleanVideoUrl(item) {
  const stream = item?.video_info_v2?.media?.stream || item?.video_info?.media?.stream || item?.media?.stream;
  if (!stream) return "";
  const h265List = stream?.h265 || [];
  const h264List = stream?.h264 || [];

  for (let s of h265List) {
    if (s?.master_url) return s.master_url;
    if (s?.backup_urls?.[0]) return s.backup_urls[0];
  }
  for (let s of h264List) {
    if (s?.master_url) return s.master_url;
    if (s?.backup_urls?.[0]) return s.backup_urls[0];
  }
  return "";
}

// 兼容提取不同 API 下的笔记平铺数组（解决 obj.data[0].note_list 嵌套 Bug）
function getNoteItems(obj) {
  if (!obj || !obj.data) return [];
  if (Array.isArray(obj.data)) {
    if (obj.data[0]?.note_list && Array.isArray(obj.data[0].note_list)) {
      return obj.data[0].note_list;
    }
    return obj.data;
  }
  if (typeof obj.data === "object") {
    if (Array.isArray(obj.data.note_list)) return obj.data.note_list;
    if (Array.isArray(obj.data.items)) return obj.data.items;
  }
  return [];
}

// 1. 评论区实况照片保存
if (url.includes("/v1/interaction/comment/video/download")) {
  let commitsCache = JSON.parse($persistentStore.read("redBookCommentLivePhoto") || "null");
  if (commitsCache?.livePhotos?.length > 0 && obj?.data?.video) {
    for (const item of commitsCache.livePhotos) {
      if (item?.videId === obj?.data?.video?.video_id) {
        obj.data.video.video_url = item.videoUrl;
        break;
      }
    }
  }
} 
// 2. 笔记详情 / 首页信息流 / 视频流 (核心逻辑：解锁开关 + 提取无水印地址)
else if (
  /\/v\d+\/note\/(imagefeed|feed)/.test(url) || 
  /\/v\d+\/note\/videofeed/.test(url) || 
  url.includes("/v6/homefeed") || 
  url.includes("/v10/search/notes")
) {
  let livePhotoDatas = [];
  let videoDatas = [];
  let list = getNoteItems(obj);

  if (list.length > 0) {
    for (let item of list) {
      if (!item || typeof item !== "object") continue;

      // 强制去水印控制位
      if (!item.media_save_config) item.media_save_config = {};
      item.media_save_config.disable_save = false;
      item.media_save_config.disable_watermark = true;
      item.media_save_config.disable_weibo_cover = true;

      // 强行开启并点亮被作者限制的下载按钮
      if (!Array.isArray(item.function_switch)) item.function_switch = [];
      ["video_download", "image_download"].forEach((t) => {
        let f = item.function_switch.find((x) => x?.type === t);
        if (f) {
          f.enable = true;
          delete f.reason;
        } else {
          item.function_switch.push({ type: t, enable: true });
        }
      });

      // 抓取视频无水印直链
      let vUrl = getCleanVideoUrl(item);
      let noteId = item?.id || item?.note_id;
      if (noteId && vUrl) {
        videoDatas.push({ id: noteId, url: vUrl });
      }

      // 图片超清原图与 Live Photo 视频流
      if (Array.isArray(item.images_list)) {
        for (let i of item.images_list) {
          if (i?.original) i.url = i.original;
          if (i?.live_photo_file_id && i?.live_photo?.media) {
            let lpUrl = getCleanVideoUrl(i.live_photo);
            if (lpUrl) {
              livePhotoDatas.push({
                file_id: i.live_photo_file_id,
                video_id: i.live_photo.media.video_id,
                url: lpUrl
              });
            }
          }
        }
      }
    }

    // 更新持久化缓存
    if (livePhotoDatas.length > 0) {
      let oldLive = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
      $persistentStore.write(JSON.stringify(livePhotoDatas.concat(oldLive).slice(0, 50)), "redBookLivePhoto");
    }
    if (videoDatas.length > 0) {
      let oldVideo = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
      $persistentStore.write(JSON.stringify(videoDatas.concat(oldVideo).slice(0, 50)), "redBookVideoFeed");
    }
  }
} 
// 3. Live Photo 保存处理
else if (/\/v\d+\/note\/live_photo\/save/.test(url)) {
  let livePhoto = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
  if (obj?.data?.datas?.length > 0 && livePhoto.length > 0) {
    obj.data.datas.forEach((itemA) => {
      livePhoto.forEach((itemB) => {
        if (itemB?.file_id === itemA?.file_id && itemA?.url) {
          itemA.url = itemB.url;
        }
      });
    });
  } else if (livePhoto.length > 0) {
    obj = { code: 0, success: true, msg: "成功", data: { datas: livePhoto } };
  }
} 
// 4. 点击保存视频接口：替换为刚才捕获到的 master_url
else if (/\/v\d+\/note\/video\/save/.test(url)) {
  let videoFeed = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
  let noteId = obj?.data?.note_id || obj?.data?.id;
  if (noteId && videoFeed.length > 0) {
    let cached = videoFeed.find((i) => i.id === noteId);
    if (cached?.url) {
      obj.data.download_url = cached.url; // 强行替换为无水印原始 MP4 地址
    }
  }
  if (obj?.data) {
    if (obj.data.disable) delete obj.data.disable;
    if (obj.data.msg) delete obj.data.msg;
    obj.data.status = 2; // 标记成功
  }
} 
// 5. 基础去广告
else if (url.includes("/v1/system_service/config")) {
  const item = ["app_theme", "loading_img", "splash", "store"];
  if (obj?.data) for (let i of item) delete obj.data[i];
} else if (url.includes("/v2/system_service/splash_config")) {
  if (obj?.data?.ads_groups?.length > 0) {
    for (let i of obj.data.ads_groups) {
      i.start_time = 3818332800;
      i.end_time = 3818419199;
    }
  }
} else {
  $done({});
}

$done({ body: JSON.stringify(obj) });
