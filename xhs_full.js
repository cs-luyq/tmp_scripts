/*
  小红书无水印与全解锁终极修复版
  支持：图片无损原图 / Live Photo / 视频去水印 / 点亮作者禁止下载按钮
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

// 提取无水印视频播放流 master_url
function getCleanVideoUrl(item) {
  if (!item || typeof item !== "object") return "";
  const media = item?.video_info_v2?.media || item?.video_info?.media || item?.media;
  const stream = media?.stream;
  if (!stream) return "";
  
  // 优先 h265，兜底 h264
  const h265 = stream?.h265 || [];
  const h264 = stream?.h264 || [];
  for (let s of h265) {
    if (s?.master_url) return s.master_url;
    if (s?.backup_urls?.[0]) return s.backup_urls[0];
  }
  for (let s of h264) {
    if (s?.master_url) return s.master_url;
    if (s?.backup_urls?.[0]) return s.backup_urls[0];
  }
  return "";
}

// 安全读取持久化缓存
function getCache(key) {
  try {
    let val = $persistentStore.read(key);
    return val ? JSON.parse(val) : [];
  } catch (e) {
    return [];
  }
}

// 安全写入持久化缓存
function setCache(key, data) {
  try {
    $persistentStore.write(JSON.stringify(data), key);
  } catch (e) {}
}

// 全面解锁下载与去水印开关 (针对单条笔记)
function unlockNoteItem(item) {
  if (!item || typeof item !== "object") return;

  // 1. 根节点与媒体节点强行开锁
  item.disable_save = false;
  item.disable_download = false;
  item.video_download_disable = false;

  if (!item.media_save_config) item.media_save_config = {};
  item.media_save_config.disable_save = false;
  item.media_save_config.disable_watermark = true;
  item.media_save_config.disable_weibo_cover = true;

  if (item.share_info) {
    item.share_info.video_download_disable = false;
  }

  // 2. 强行点亮 function_switch 中的所有下载项
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
}

// 1. 匹配：笔记详情 / 信息流 / 视频流 / 搜索 / 推荐
if (
  /\/v\d+\/note\/(imagefeed|feed)/.test(url) || 
  /\/v\d+\/note\/videofeed/.test(url) || 
  url.includes("/v6/homefeed") || 
  url.includes("/v10/search/notes")
) {
  let livePhotoDatas = [];
  let videoDatas = [];

  // 兼容多重数据结构 (Array / note_list / items)
  let rawData = obj?.data;
  let list = [];
  if (Array.isArray(rawData)) {
    if (rawData[0]?.note_list && Array.isArray(rawData[0].note_list)) {
      list = rawData[0].note_list;
    } else {
      list = rawData;
    }
  } else if (rawData && typeof rawData === "object") {
    list = rawData.note_list || rawData.items || [];
  }

  if (list.length > 0) {
    for (let item of list) {
      if (!item || typeof item !== "object") continue;

      // 全面解锁下载开关与去水印控制
      unlockNoteItem(item);

      // 提取无水印视频直链
      let vUrl = getCleanVideoUrl(item);
      let noteId = item?.id || item?.note_id;
      if (noteId && vUrl) {
        videoDatas.push({ id: String(noteId), url: vUrl });
      }

      // 提取图片原图与 Live Photo
      if (Array.isArray(item.images_list)) {
        for (let i of item.images_list) {
          if (i?.original) i.url = i.original;
          if (i?.live_photo_file_id && i?.live_photo?.media) {
            let lpUrl = getCleanVideoUrl(i.live_photo);
            if (lpUrl) {
              livePhotoDatas.push({
                file_id: String(i.live_photo_file_id),
                video_id: String(i.live_photo.media.video_id),
                url: lpUrl
              });
            }
          }
        }
      }
    }

    // 写入缓存
    if (livePhotoDatas.length > 0) {
      let oldLive = getCache("redBookLivePhoto");
      setCache("redBookLivePhoto", livePhotoDatas.concat(oldLive).slice(0, 50));
    }
    if (videoDatas.length > 0) {
      let oldVideo = getCache("redBookVideoFeed");
      setCache("redBookVideoFeed", videoDatas.concat(oldVideo).slice(0, 50));
    }
  }
} 
// 2. 匹配：Live Photo 保存请求
else if (/\/v\d+\/note\/live_photo\/save/.test(url)) {
  let livePhoto = getCache("redBookLivePhoto");
  if (obj?.data?.datas?.length > 0 && livePhoto.length > 0) {
    obj.data.datas.forEach((itemA) => {
      livePhoto.forEach((itemB) => {
        if (itemB?.file_id === String(itemA?.file_id) && itemA?.url) {
          itemA.url = itemB.url;
        }
      });
    });
  } else if (livePhoto.length > 0) {
    obj = { code: 0, success: true, msg: "成功", data: { datas: livePhoto } };
  }
} 
// 3. 匹配：点击保存视频接口 (/note/video/save)
else if (/\/v\d+\/note\/video\/save/.test(url)) {
  let videoFeed = getCache("redBookVideoFeed");
  let noteId = String(obj?.data?.note_id || obj?.data?.id || "");
  
  if (noteId && videoFeed.length > 0) {
    let cached = videoFeed.find((i) => String(i.id) === noteId);
    if (cached?.url) {
      obj.data.download_url = cached.url; // 强行替换为抓取到的无水印 MP4 直链
    }
  }
  
  // 突破保存拒绝
  if (obj?.data) {
    delete obj.data.disable;
    delete obj.data.msg;
    obj.data.status = 2;
  }
} 
// 4. 基础去广告
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
