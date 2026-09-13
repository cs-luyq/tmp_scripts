/*
  小红书全功能修复版 (去广告 + 图片去水印 + Live Photo保存修复 + 突破视频禁止下载)
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

// 提取媒体流地址的通用兼容函数 (兼容 h265 / h264 / 备用流)
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

// 专门为视频点亮保存按钮
function fixVideoDownload(item) {
  if (!item) return;
  if (!item.media_save_config) item.media_save_config = {};
  item.media_save_config.disable_save = false;
  item.media_save_config.disable_watermark = true;

  if (item?.function_switch?.length > 0) {
    for (let f of item.function_switch) {
      if (f?.type === "video_download") {
        f.enable = true;
        delete f.reason;
      }
    }
  }

  if (item?.share_info?.function_entries) {
    let entries = item.share_info.function_entries;
    let idx = entries.findIndex((e) => e?.type === "video_download");
    if (idx !== -1) {
      let entry = entries.splice(idx, 1)[0];
      entries.unshift(entry);
    } else {
      entries.unshift({ type: "video_download" });
    }
  }
}

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
} else if (url.includes("/v1/note/imagefeed") || url.includes("/v2/note/feed")) {
  // 信息流/笔记详情
  let livePhotoDatas = [];
  let videoDatas = [];

  if (obj?.data?.[0]?.note_list?.length > 0) {
    for (let item of obj.data[0].note_list) {
      // 关水印与开关
      if (item?.media_save_config) {
        item.media_save_config.disable_save = false;
        item.media_save_config.disable_watermark = true;
      }

      // 如果是视频笔记，修复视频下载限制
      if (item?.type === "video" || item?.video_info_v2) {
        fixVideoDownload(item);
        let vUrl = getStreamUrl(item?.video_info_v2?.media || item?.video_info?.media);
        if (item?.id && vUrl) videoDatas.push({ id: item.id, url: vUrl });
      }

      // 图片与 Live Photo 提取
      if (item?.images_list?.length > 0) {
        for (let i of item.images_list) {
          if (i?.original) i.url = i.original; // 替换无损高清原图

          // 修复 Live Photo 视频流提取
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

    // 独立且安全地写入存储，防止误清空
    if (livePhotoDatas.length > 0) {
      let oldLive = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
      let combinedLive = livePhotoDatas.concat(oldLive).slice(0, 50);
      $persistentStore.write(JSON.stringify(combinedLive), "redBookLivePhoto");
    }

    if (videoDatas.length > 0) {
      let oldVideo = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
      let combinedVideo = videoDatas.concat(oldVideo).slice(0, 50);
      $persistentStore.write(JSON.stringify(combinedVideo), "redBookVideoFeed");
    }
  }
} else if (/\/v\d+\/note\/live_photo\/save/.test(url)) {
  // 实况照片保存请求修复
  let livePhoto = JSON.parse($persistentStore.read("redBookLivePhoto") || "[]");
  if (obj?.data?.datas?.length > 0) {
    if (livePhoto.length > 0) {
      obj.data.datas.forEach((itemA) => {
        livePhoto.forEach((itemB) => {
          if (itemB?.file_id === itemA?.file_id && itemA?.url) {
            itemA.url = itemB.url;
          }
        });
      });
    }
  } else if (livePhoto.length > 0) {
    obj = { code: 0, success: true, msg: "成功", data: { datas: livePhoto } };
  }
} else if (/\/v\d+\/note\/videofeed/.test(url)) {
  // 视频推荐信息流
  let videoDatas = [];
  let modDatas = [];
  let list = Array.isArray(obj?.data) ? obj.data : obj?.data?.items;
  if (list?.length > 0) {
    for (let item of list) {
      fixVideoDownload(item);
      let vUrl = getStreamUrl(item?.video_info_v2?.media || item?.video_info?.media);
      if (item?.id && vUrl) videoDatas.push({ id: item.id, url: vUrl });
      if (!item.hasOwnProperty("ad")) modDatas.push(item);
    }
    if (Array.isArray(obj?.data)) obj.data = modDatas;
    if (videoDatas.length > 0) {
      let oldVideo = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
      let combinedVideo = videoDatas.concat(oldVideo).slice(0, 50);
      $persistentStore.write(JSON.stringify(combinedVideo), "redBookVideoFeed");
    }
  }
} else if (/\/v\d+\/note\/video\/save/.test(url)) {
  // 破解被作者限制下载的视频
  let videoFeed = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
  if (obj?.data?.note_id) {
    let cached = videoFeed.find((i) => i.id === obj.data.note_id);
    if (cached?.url) obj.data.download_url = cached.url;
    if (obj?.data?.disable) {
      delete obj.data.disable;
      delete obj.data.msg;
      obj.data.status = 2; // 标记保存成功
    }
  }
} else if (url.includes("/v1/system/service/ui/config")) {
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
