/*
  小红书无水印高性能精简版 (图片原图 + LivePhoto + 视频无水印 + 去广告)
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

// 提取播放器原原生无水印视频流 (优先 h265 最高清，兜底 h264)
function getCleanVideoUrl(item) {
  const stream = item?.video_info_v2?.media?.stream;
  if (!stream) return "";
  return (
    stream?.h265?.[0]?.master_url ||
    stream?.h264?.[0]?.master_url ||
    stream?.h265?.[0]?.backup_urls?.[0] ||
    stream?.h264?.[0]?.backup_urls?.[0] ||
    ""
  );
}

// 1. 评论区实况照片
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
// 2. 笔记/图文/视频 信息流 (无水印提取与开关处理)
else if (/\/v\d+\/note\/(imagefeed|feed)/.test(url) || /\/v\d+\/note\/videofeed/.test(url) || url.includes("/v6/homefeed")) {
  let livePhotoDatas = [];
  let videoDatas = [];
  let modItems = [];

  let list = Array.isArray(obj?.data) ? obj.data : (obj?.data?.[0]?.note_list || obj?.data?.items);

  if (list?.length > 0) {
    for (let item of list) {
      // 去广告：跳过带 ad 或带货的节点
      if (item?.ad || item.hasOwnProperty("ads_info") || item?.model_type === "live_v2") {
        continue;
      }

      // 解锁去水印控制开关
      if (item?.media_save_config) {
        item.media_save_config.disable_save = false;
        item.media_save_config.disable_watermark = true;
        item.media_save_config.disable_weibo_cover = true;
      }

      // 强行开启被作者禁止的视频下载按钮
      if (item?.function_switch?.length > 0) {
        for (let f of item.function_switch) {
          if (f?.type === "video_download") {
            f.enable = true;
            delete f.reason;
          }
        }
      }

      // 提取视频纯净直链 (匹配你的视频 JSON)
      let vUrl = getCleanVideoUrl(item);
      let noteId = item?.id || item?.note_id;
      if (noteId && vUrl) {
        videoDatas.push({ id: noteId, url: vUrl });
      }

      // 提取图片高清原图与 Live Photo
      if (item?.images_list?.length > 0) {
        for (let i of item.images_list) {
          if (i?.original) i.url = i.original; // 替换为无损原图
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

      modItems.push(item);
    }

    // 重写数组数据 (完成去广告)
    if (Array.isArray(obj?.data)) obj.data = modItems;

    // 轻量级缓存（仅维护最近 50 条）
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
// 4. 视频点击保存接口：把服务器返回的带水印链接替换为刚才捕获到的 master_url 纯净流
else if (/\/v\d+\/note\/video\/save/.test(url)) {
  let videoFeed = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
  let noteId = obj?.data?.note_id || obj?.data?.id;
  if (noteId && videoFeed.length > 0) {
    let cached = videoFeed.find((i) => i.id === noteId);
    if (cached?.url) {
      obj.data.download_url = cached.url; // 核心：替换为纯净无水印直链
    }
  }
  if (obj?.data?.disable) {
    delete obj.data.disable;
    delete obj.data.msg;
    obj.data.status = 2; // 顺便解锁作者限制下载
  }
} 
// 5. 杂项与 UI 去广告
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
