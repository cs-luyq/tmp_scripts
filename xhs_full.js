/*
  小红书全功能修复版 (去广告 + 去水印 + 破限制 + 实况/视频下载 + 解除用户限制下载)
*/

const url = $request.url;
if (!$response.body) $done({});
let obj = JSON.parse($response.body);

if (url.includes("/v1/interaction/comment/video/download")) {
  // 评论区实况照片保存请求
  let commitsCache = JSON.parse($persistentStore.read("redBookCommentLivePhoto") || "null");
  if (commitsCache) {
    let commitsRsp = commitsCache;
    if (commitsRsp?.livePhotos?.length > 0 && obj?.data?.video) {
      for (const item of commitsRsp.livePhotos) {
        if (item?.videId === obj?.data?.video?.video_id) {
          obj.data.video.video_url = item.videoUrl;
          break;
        }
      }
    }
  }
} else if (url.includes("/v1/note/imagefeed") || url.includes("/v2/note/feed")) {
  // 信息流 图片（带无水印与高清原图修复）
  let newDatas = [];
  if (obj?.data?.[0]?.note_list?.length > 0) {
    for (let item of obj.data[0].note_list) {
      if (item?.function_switch?.length > 0) {
        for (let i of item.function_switch) {
          if (i?.enable === false) {
            i.enable = true;
            i.reason = "";
          }
        }
      }
      if (item?.media_save_config) {
        item.media_save_config.disable_save = false;
        item.media_save_config.disable_watermark = true;
        item.media_save_config.disable_weibo_cover = true;
      }
      if (item?.share_info?.function_entries?.length > 0) {
        const additem = { type: "video_download" };
        let videoDownloadIndex = item.share_info.function_entries.findIndex((i) => i?.type === "video_download");
        if (videoDownloadIndex !== -1) {
          let videoDownloadEntry = item.share_info.function_entries.splice(videoDownloadIndex, 1)[0];
          item.share_info.function_entries.splice(0, 0, videoDownloadEntry);
        } else {
          item.share_info.function_entries.splice(0, 0, additem);
        }
      }
      if (item?.images_list?.length > 0) {
        for (let i of item.images_list) {
          if (i?.original) {
            i.url = i.original; // 替换为高清原图
          }
          if (i.hasOwnProperty("live_photo_file_id") && i.hasOwnProperty("live_photo")) {
            if (
              i?.live_photo_file_id &&
              i?.live_photo?.media?.video_id &&
              i?.live_photo?.media?.stream?.h265?.[0]?.master_url
            ) {
              let myData = {
                file_id: i.live_photo_file_id,
                video_id: i.live_photo.media.video_id,
                url: i.live_photo.media.stream.h265[0].master_url
              };
              newDatas.push(myData);
            }
            $persistentStore.write(JSON.stringify(newDatas), "redBookLivePhoto");
          }
        }
      }
    }
  }
} else if (url.includes("/v1/note/live_photo/save")) {
  // 实况照片保存请求
  let livePhoto = JSON.parse($persistentStore.read("redBookLivePhoto") || "null");
  if (obj?.data?.datas?.length > 0) {
    if (livePhoto?.length > 0) {
      obj.data.datas.forEach((itemA) => {
        livePhoto.forEach((itemB) => {
          if (itemB?.file_id === itemA?.file_id && itemA?.url) {
            itemA.url = itemA.url.replace(/^https?:\/\/.*\.mp4/g, itemB.url);
          }
        });
      });
    }
  } else {
    obj = { code: 0, success: true, msg: "成功", data: { datas: livePhoto } };
  }
} else if (url.includes("/v1/system/service/ui/config")) {
  if (obj?.data?.sideConfigHomepage?.componentConfig?.sidebar_config_cny_2025) {
    obj.data.sideConfigHomepage.componentConfig.sidebar_config_cny_2025 = {};
  }
  if (obj?.data?.sideConfigPersonalPage?.componentConfig?.sidebar_config_cny_2025) {
    obj.data.sideConfigPersonalPage.componentConfig.sidebar_config_cny_2025 = {};
  }
} else if (url.includes("/v1/system_service/config")) {
  const item = ["app_theme", "loading_img", "splash", "store"];
  if (obj?.data) {
    for (let i of item) delete obj.data[i];
  }
} else if (url.includes("/v2/note/widgets")) {
  const item = ["cooperate_binds", "generic", "note_next_step", "widget_list", "widgets_nbb", "widgets_ncb", "widgets_ndb"];
  if (obj?.data) {
    for (let i of item) delete obj.data[i];
  }
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
} else if (/\/v\d+\/note\/videofeed/.test(url)) {
  // 【重写】：视频信息流（兼容 v3/v4/v5 等全版本，提前提取无水印视频并强制开开关）
  let newDatas = [];
  let modDatas = [];
  let list = Array.isArray(obj?.data) ? obj.data : obj?.data?.items;
  if (list?.length > 0) {
    for (let item of list) {
      if (item?.function_switch?.length > 0) {
        for (let i of item.function_switch) {
          i.enable = true;
          delete i.reason;
        }
      }
      if (item?.media_save_config) {
        item.media_save_config.disable_save = false;
        item.media_save_config.disable_watermark = true;
      }
      // 提取真实播放流
      let videoUrl = item?.video_info_v2?.media?.stream?.h265?.[0]?.master_url ||
                     item?.video_info_v2?.media?.stream?.h264?.[0]?.master_url ||
                     item?.video_info?.media?.stream?.h265?.[0]?.master_url;
      if (item?.id && videoUrl) {
        newDatas.push({ id: item.id, url: videoUrl });
      }
      if (!item.hasOwnProperty("ad")) {
        modDatas.push(item);
      }
    }
    if (Array.isArray(obj?.data)) obj.data = modDatas;
    let oldCache = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
    let combined = newDatas.concat(oldCache).slice(0, 50);
    $persistentStore.write(JSON.stringify(combined), "redBookVideoFeed");
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
            if (picObj?.stream?.h265?.[0]?.master_url) {
              livePhotos.push({ videId: picture.video_id, videoUrl: picObj.stream.h265[0].master_url });
            }
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
  if (obj?.data?.title === "你可能感兴趣的人" && obj?.data?.rec_users?.length > 0) {
    obj.data = {};
  }
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
} else if (/\/v\d+\/note\/video\/save/.test(url)) {
  // 【重写】：突破保存接口限制（强行替换被拒绝的请求）
  let videoFeed = JSON.parse($persistentStore.read("redBookVideoFeed") || "[]");
  if (obj?.data?.note_id) {
    let cached = videoFeed.find((i) => i.id === obj.data.note_id);
    if (cached?.url) {
      obj.data.download_url = cached.url;
    }
    if (obj?.data?.disable) {
      delete obj.data.disable;
      delete obj.data.msg;
      obj.data.status = 2; // 强制标记为保存成功
    }
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
