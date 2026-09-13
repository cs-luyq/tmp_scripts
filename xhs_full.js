/*
  小红书纯净高性能版 (去广告 + 图文无损原图去水印 + Live Photo修复)
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

// 提取媒体流 master_url
function getStreamUrl(media) {
  if (!media?.stream) return "";
  const s = media.stream;
  return (
    s?.h265?.[0]?.master_url ||
    s?.h264?.[0]?.master_url ||
    s?.h265?.[0]?.backup_url?.[0] ||
    s?.h264?.[0]?.backup_url?.[0] ||
    ""
  );
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
// 2. 图文/笔记信息流 (替换无损原图 + 提取 Live Photo 视频流)
else if (/\/v\d+\/note\/(imagefeed|feed)/.test(url)) {
  let livePhotoDatas = [];
  if (obj?.data?.[0]?.note_list?.length > 0) {
    for (let item of obj.data[0].note_list) {
      if (item?.media_save_config) {
        item.media_save_config.disable_save = false;
        item.media_save_config.disable_watermark = true;
      }

      if (item?.images_list?.length > 0) {
        for (let i of item.images_list) {
          // 替换无损高清原图 (去水印且不模糊)
          if (i?.original) i.url = i.original;
          
          // Live Photo 提取
          if (i?.live_photo_file_id && i?.live_photo?.media) {
            let lpUrl = getStreamUrl(i.live_photo.media);
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

    if (livePhotoDatas.length > 0) {
      let oldLive = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
      $persistentStore.write(JSON.stringify(livePhotoDatas.concat(oldLive).slice(0, 50)), "redBookLivePhoto");
    }
  }
} 
// 3. Live Photo 保存响应处理
else if (/\/v\d+\/note\/live_photo\/save/.test(url)) {
  let livePhoto = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
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
// 4. 信息流去广告 (首页推荐 / 视频推荐)
else if (/\/v\d+\/note\/videofeed/.test(url) || url.includes("/v6/homefeed")) {
  let modDatas = [];
  let list = Array.isArray(obj?.data) ? obj.data : obj?.data?.items;
  if (list?.length > 0) {
    for (let item of list) {
      // 过滤广告/带货/直播节点
      if (item?.model_type === "live_v2" || item.hasOwnProperty("ad") || item.hasOwnProperty("ads_info") || item.hasOwnProperty("card_icon") || item?.has_related_goods === true) {
        continue;
      }
      modDatas.push(item);
    }
    if (Array.isArray(obj?.data)) obj.data = modDatas;
  }
} 
// 5. 评论区视频实况列表
else if (url.includes("/v5/note/comment/list")) {
  replaceRedIdWithFmz200(obj.data);
  let livePhotos = [];
  let note_id = "";
  if (obj?.data?.comments?.length > 0) {
    note_id = obj.data.comments[0].note_id;
    for (const comment of obj.data.comments) {
      if (comment?.comment_type === 3) comment.comment_type = 2;
      if (comment?.media_source_type === 1) comment.media_source_type = 0;
      if (comment?.pictures?.length > 0) {
        for (const picture of comment.pictures) {
          if (picture?.video_id) {
            const picObj = JSON.parse(picture.video_info);
            let lpUrl = getStreamUrl(picObj);
            if (lpUrl) livePhotos.push({ videId: picture.video_id, videoUrl: lpUrl });
          }
        }
      }
    }
  }
  if (livePhotos?.length > 0) {
    let commitsCache = JSON.parse($persistentStore.read("redBookCommentLivePhoto") || "null");
    let commitsRsp = (!commitsCache || commitsCache?.noteId !== note_id)
      ? { noteId: note_id, livePhotos: livePhotos }
      : { noteId: note_id, livePhotos: deduplicateLivePhotos(commitsCache.livePhotos.concat(livePhotos)) };
    $persistentStore.write(JSON.stringify(commitsRsp), "redBookCommentLivePhoto");
  }
} 
// 6. 基础开屏与 UI 广告清理
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

function deduplicateLivePhotos(livePhotos) {
  const seen = new Map();
  return livePhotos.filter((item) => {
    if (seen.has(item.videId)) return false;
    seen.set(item.videId, true);
    return true;
  });
}

function replaceRedIdWithFmz200(obj) {
  if (Array.isArray(obj)) {
    obj.forEach((item) => replaceRedIdWithFmz200(item));
  } else if (typeof obj === "object" && obj !== null) {
    if ("red_id" in obj) {
      obj.fmz200 = obj.red_id;
      delete obj.red_id;
    }
    Object.keys(obj).forEach((key) => replaceRedIdWithFmz200(obj[key]));
  }
}
