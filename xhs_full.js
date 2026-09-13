/*
  小红书无水印精简版 (去广告 + 图片原图/去水印 + Live Photo修复 + 视频去水印)
  特点：移除全局递归扫描，轻量高性能
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

// 提取视频/Live Photo 播放流地址 (兼容 h265 / h264)
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

// 统一去水印配置
function removeWatermarkConfig(item) {
  if (!item) return;
  if (item?.media_save_config) {
    item.media_save_config.disable_save = false;
    item.media_save_config.disable_watermark = true;
    item.media_save_config.disable_weibo_cover = true;
  }
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
// 2. 笔记/图文/视频 信息流 (图片/Live Photo/普通视频去水印)
else if (/\/v\d+\/note\/(imagefeed|feed)/.test(url)) {
  let livePhotoDatas = [];
  if (obj?.data?.[0]?.note_list?.length > 0) {
    for (let item of obj.data[0].note_list) {
      removeWatermarkConfig(item);

      if (item?.images_list?.length > 0) {
        for (let i of item.images_list) {
          // 图片：直接使用 original 无损原图链接，抹去水印并解决模糊
          if (i?.original) {
            i.url = i.original;
          }
          // Live Photo：抓取高清视频流，保存至临时记录
          if (i?.live_photo_file_id && i?.live_photo?.media) {
            let lpUrl = getStreamUrl(i.live_photo.media);
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

    if (livePhotoDatas.length > 0) {
      let oldLive = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
      let combinedLive = livePhotoDatas.concat(oldLive).slice(0, 50);
      $persistentStore.write(JSON.stringify(combinedLive), "redBookLivePhoto");
    }
  }
} 
// 3. Live Photo 实况照片保存响应处理
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
// 4. 视频信息流去水印与去广告
else if (/\/v\d+\/note\/videofeed/.test(url)) {
  let modDatas = [];
  let list = Array.isArray(obj?.data) ? obj.data : obj?.data?.items;
  if (list?.length > 0) {
    for (let item of list) {
      removeWatermarkConfig(item);
      if (!item.hasOwnProperty("ad")) modDatas.push(item);
    }
    if (Array.isArray(obj?.data)) obj.data = modDatas;
  }
} 
// 5. 视频保存接口 (清空 URL 里的 CDN 水印处理参数)
else if (/\/v\d+\/note\/video\/save/.test(url)) {
  if (obj?.data?.download_url) {
    obj.data.download_url = obj.data.download_url
      .replace(/(\?|&)x-oss-process=[^&]*/g, "")
      .replace(/(\?|&)imageMogr2=[^&]*/g, "");
  }
} 
// 6. UI 与开屏广告剔除
else if (url.includes("/v1/system/service/ui/config")) {
  if (obj?.data?.sideConfigHomepage?.componentConfig?.sidebar_config_cny_2025) obj.data.sideConfigHomepage.componentConfig.sidebar_config_cny_2025 = {};
  if (obj?.data?.sideConfigPersonalPage?.componentConfig?.sidebar_config_cny_2025) obj.data.sideConfigPersonalPage.componentConfig.sidebar_config_cny_2025 = {};
} else if (url.includes("/v1/system_service/config")) {
  const item = ["app_theme", "loading_img", "splash", "store"];
  if (obj?.data) for (let i of item) delete obj.data[i];
} else if (url.includes("/v2/note/widgets")) {
  const item = ["cooperate_binds", "generic", "note_next_step", "widget_list", "widgets_nbb", "widgets_ncb", "widgets_ndb"];
  if (obj?.data) for (let i of item) delete obj.data[i];
} else if (url.includes("/v2/system_service/splash_config")) {
  if (obj?.data?.ads_groups?.length > 0) {
    for (let i of obj.data.ads_groups) {
      i.start_time = 3818332800;
      i.end_time = 3818419199;
      if (i?.ads?.length > 0) {
        for (let ii of i.ads) {
          ii.start_time = 3818332800;
          ii.end_time = 3818419199;
        }
      }
    }
  }
} else if (url.includes("/v2/user/followings/followfeed")) {
  if (obj?.data?.items?.length > 0) {
    obj.data.items = obj.data.items.filter((i) => i?.recommend_reason === "friend_post");
  }
} else if (url.includes("/v4/followfeed")) {
  if (obj?.data?.items?.length > 0) {
    obj.data.items = obj.data.items.filter((i) => !["recommend_user"].includes(i?.recommend_reason));
  }
} else if (url.includes("/v5/note/comment/list")) {
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
} else if (url.includes("/v5/recommend/user/follow_recommend")) {
  if (obj?.data?.title === "你可能感兴趣的人" && obj?.data?.rec_users?.length > 0) obj.data = {};
} else if (url.includes("/v6/homefeed")) {
  if (obj?.data?.length > 0) {
    let newItems = [];
    for (let item of obj.data) {
      if (item?.model_type === "live_v2" || item.hasOwnProperty("ads_info") || item.hasOwnProperty("card_icon") || item.hasOwnProperty("note_attributes") || item?.note_attributes?.includes("goods") || item?.has_related_goods === true) {
        continue;
      } else {
        if (item?.related_ques) delete item.related_ques;
        newItems.push(item);
      }
    }
    obj.data = newItems;
  }
} else if (url.includes("/v10/search/notes")) {
  if (obj?.data?.items?.length > 0) {
    obj.data.items = obj.data.items.filter((i) => i?.model_type === "note");
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
