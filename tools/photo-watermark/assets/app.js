/**
 * 照片水印 —— 浏览器端 EXIF 读取 + Canvas 水印绘制
 * 无依赖（exifr 通过 <script> 全局引入），照片不上传。
 */
(function () {
  'use strict';

  /* ============================== 配置 ============================== */

  var CFG = window.PW_CONFIG || {};
  var WORKER_URL = String(CFG.workerUrl || '').trim().replace(/\/+$/, '');
  var TDT_KEY = String(CFG.tdtKey || '').trim();

  var FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
  var MAX_PREVIEW = 1600;          // 预览画布最长边
  var JPEG_QUALITY = 0.94;

  /* ============================== DOM ============================== */

  var el = {
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    canvasBox: document.getElementById('canvasBox'),
    preview: document.getElementById('preview'),
    fModel: document.getElementById('f-model'),
    fWhen: document.getElementById('f-when'),
    fPlace: document.getElementById('f-place'),
    fParams: document.getElementById('f-params'),
    placeStatus: document.getElementById('placeStatus'),
    btnRegeo: document.getElementById('btnRegeo'),
    optParams: document.getElementById('optParams'),
    optPlace: document.getElementById('optPlace'),
    optSize: document.getElementById('optSize'),
    sizeLabel: document.getElementById('sizeLabel'),
    btnDownload: document.getElementById('btnDownload'),
    btnReset: document.getElementById('btnReset'),
    notice: document.getElementById('notice'),
    netState: document.getElementById('netState')
  };

  /* ============================== 状态 ============================== */

  var state = {
    file: null,
    bitmap: null,      // ImageBitmap 或 HTMLImageElement
    width: 0,
    height: 0,
    gps: null,         // { latitude, longitude }
    fileName: 'photo'
  };

  /* ============================== 工具 ============================== */

  function notice(msg, kind) {
    if (!msg) {
      el.notice.hidden = true;
      el.notice.textContent = '';
      return;
    }
    el.notice.hidden = false;
    el.notice.textContent = msg;
    el.notice.className = 'notice' + (kind ? ' ' + kind : '');
  }

  function setPlaceStatus(text, kind) {
    el.placeStatus.textContent = text || '';
    el.placeStatus.className = 'tag' + (kind ? ' ' + kind : '');
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* ============================== EXIF 解析 ============================== */

  /**
   * EXIF 里的 DateTimeOriginal 被 exifr 按「本地时间」还原成 Date，
   * 因此用 getFullYear() 等本地分量即可拿到相机记录的原始时间。
   */
  function fmtWhen(v) {
    if (!v) return '';
    if (v instanceof Date && !isNaN(v.getTime())) {
      return v.getFullYear() + '.' + pad2(v.getMonth() + 1) + '.' + pad2(v.getDate()) +
        ' ' + pad2(v.getHours()) + ':' + pad2(v.getMinutes());
    }
    var s = String(v);
    var m = s.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})\D+(\d{1,2})\D(\d{1,2})/);
    if (m) {
      return m[1] + '.' + pad2(+m[2]) + '.' + pad2(+m[3]) + ' ' + pad2(+m[4]) + ':' + pad2(+m[5]);
    }
    return s;
  }

  var MAKE_FIX = {
    'nikon corporation': 'Nikon',
    'olympus corporation': 'Olympus',
    'olympus imaging corp.': 'Olympus',
    'olympus imaging corporation': 'Olympus',
    'panasonic': 'Panasonic',
    'fujifilm': 'Fujifilm',
    'samsung': 'Samsung',
    'motorola': 'Motorola'
  };

  function prettyMake(make) {
    var mk = String(make || '').trim();
    var key = mk.toLowerCase();
    if (MAKE_FIX[key]) return MAKE_FIX[key];
    if (/^[A-Z0-9\s.]+$/.test(mk) && mk.length > 3) {
      // 全大写 → 首字母大写（SONY → Sony）
      return mk.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    }
    return mk;
  }

  /**
   * 机型清洗：手机型号通常已含品牌（iPhone 15 Pro），不再加前缀；
   * 相机型号常常只是代号（D750 / EOS R5），补上厂商名更可读。
   */
  function cleanModel(make, model) {
    var m = String(model || '').trim();
    var mk = String(make || '').trim();
    if (!m) return prettyMake(mk);
    if (!mk) return m;

    var nice = prettyMake(mk);
    var hasMake = m.toLowerCase().indexOf(mk.toLowerCase()) === 0 ||
      m.toLowerCase().indexOf(nice.toLowerCase()) === 0;
    if (hasMake) return m;

    var isPhone = /^(iPhone|iPad|Pixel|Galaxy|Redmi|Mi\b|POCO|SM-|Nexus)/i.test(m);
    if (isPhone) return m;

    // 短型号（相机机身）补厂商前缀
    if (m.length <= 14) return nice + ' ' + m;
    return m;
  }

  function num(v) {
    if (Array.isArray(v)) v = v[0];
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fmtParams(exif) {
    var out = [];

    var f = num(exif.FNumber);
    if (f) out.push('f/' + (Number.isInteger(f) ? f : f.toFixed(1)));

    var t = exif.ExposureTime;
    if (Array.isArray(t)) t = t[0];
    if (t != null && t !== '') {
      if (typeof t === 'string') {
        out.push(/[/]/.test(t) ? t + 's' : t + 's');
      } else {
        var tv = Number(t);
        if (isFinite(tv) && tv > 0) {
          out.push(tv >= 1 ? tv + 's' : '1/' + Math.round(1 / tv) + 's');
        }
      }
    }

    var iso = num(exif.ISO);
    if (iso) out.push('ISO ' + iso);

    var fl = num(exif.FocalLength);
    if (fl) out.push(Math.round(fl) + 'mm');

    return out.join(' · ');
  }

  function readGps(exif) {
    var lat = num(exif.GPSLatitude);
    var lon = num(exif.GPSLongitude);
    if (lat == null || lon == null) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    if (lat === 0 && lon === 0) return null;
    return { latitude: lat, longitude: lon };
  }

  async function parseExif(file) {
    if (typeof exifr === 'undefined') return null;
    try {
      var data = await exifr.parse(file, {
        pick: [
          'Make', 'Model', 'LensModel',
          'DateTimeOriginal', 'CreateDate', 'ModifyDate',
          'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
          'FNumber', 'ExposureTime', 'ISO', 'FocalLength'
        ],
        gps: true
      });
      return data || null;
    } catch (e) {
      console.warn('[exif] 解析失败', e);
      return null;
    }
  }

  /* ============================== 图片加载 ============================== */

  function isHeic(file) {
    return /heic|heif/i.test(file.type || '') || /\.hei[cf]$/i.test(file.name || '');
  }

  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        resolve(im);
      };
      im.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('decode-failed'));
      };
      im.src = url;
    });
  }

  async function loadImage(file) {
    // createImageBitmap 带 imageOrientation，能直接把 EXIF 旋转角应用到像素上
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) { /* 落到 <img> 方案 */ }
      try {
        return await createImageBitmap(file);
      } catch (e) { /* 继续降级 */ }
    }
    return await loadViaImage(file);
  }

  /* ---------------------- HEIC / HEIF（WASM 解码） ---------------------- */
  /*
   * Chrome / Firefox / Edge 都不带 HEVC 解码器，HEIC 必须自己解。
   * 这里用 libheif 的 WASM 构建，但**按需加载**：
   * 只有用户真的选了 HEIC 才会去下这 2MB，普通 JPG 用户完全不受影响。
   */

  var heifLibPromise = null;
  var heifModulePromise = null;

  function loadHeifLib() {
    if (window.libheif) return Promise.resolve(window.libheif);
    if (heifLibPromise) return heifLibPromise;

    heifLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = './assets/libheif.bundle.js';
      s.async = true;
      s.onload = function () {
        if (window.libheif) resolve(window.libheif);
        else reject(new Error('libheif-missing'));
      };
      s.onerror = function () {
        heifLibPromise = null;
        reject(new Error('libheif-load-failed'));
      };
      document.head.appendChild(s);
    });

    return heifLibPromise;
  }

  function getHeifModule() {
    if (heifModulePromise) return heifModulePromise;

    // 这个 bundle 导出的是 Emscripten 工厂函数，调用后才得到带 HeifDecoder 的 Module
    heifModulePromise = loadHeifLib()
      .then(function (factory) { return factory(); })
      .catch(function (e) {
        heifModulePromise = null;
        throw e;
      });

    return heifModulePromise;
  }

  async function decodeHeic(file) {
    var buf = await file.arrayBuffer();
    var mod = await getHeifModule();

    var decoder = new mod.HeifDecoder();
    var images = decoder.decode(new Uint8Array(buf));
    if (!images || !images.length) throw new Error('heic-no-image');

    var image = images[0];
    var w = image.get_width();
    var h = image.get_height();
    if (!w || !h) throw new Error('heic-bad-size');

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    var ctx = canvas.getContext('2d');
    var imageData = ctx.createImageData(w, h);

    // libheif 的 display 是回调式：成功回传 imageData，失败回传 null
    await new Promise(function (resolve, reject) {
      image.display(imageData, function (out) {
        if (out) resolve();
        else reject(new Error('heic-display-failed'));
      });
    });

    ctx.putImageData(imageData, 0, 0);

    try {
      images.forEach(function (im) {
        if (im && typeof im.free === 'function') im.free();
      });
    } catch (e) { /* 释放失败不影响结果 */ }

    return canvas;
  }

  /** 原生能解就直接解（Safari 原生支持 HEIC），解不了才上 WASM */
  async function decodeImage(file, onStage) {
    try {
      return await loadImage(file);
    } catch (e) {
      if (!isHeic(file)) throw e;
    }

    if (!window.libheif && onStage) onStage('loading-lib');
    return await decodeHeic(file);
  }

  /* ============================== 水印绘制 ============================== */

  function font(size, weight) {
    return weight + ' ' + Math.round(size) + 'px ' + FONT_STACK;
  }

  /**
   * 右下角极简双行：
   *   第一行  机型  |  f/1.8 · 1/120s · ISO 200
   *   第二行  2026.10.29 21:46  ·  绵阳市涪城区
   */
  function drawWatermark(ctx, W, H, meta, opts) {
    var line1 = [meta.model, opts.showParams ? meta.params : '']
      .filter(Boolean).join('   |   ');
    var line2 = [meta.when, opts.showPlace ? meta.place : '']
      .filter(Boolean).join('   ·   ');

    if (!line1 && !line2) return;

    var sizeScale = opts.sizeScale || 1;
    var base = Math.min(W, H) * 0.021 * sizeScale;
    base = Math.max(base, 10);

    var pad = base * 1.9;
    var gap = base * 0.52;
    var maxW = W - pad * 2;

    var ctxAny = ctx;

    // 从下往上排：第二行（时间/地点）贴底，第一行（机型/参数）在其上方
    function drawLine(text, size, weight, y, alpha) {
      // 超宽时自动缩小
      var s = size;
      ctxAny.font = font(s, weight);
      var guard = 0;
      while (ctxAny.measureText(text).width > maxW && s > size * 0.5 && guard++ < 80) {
        s -= Math.max(1, size * 0.02);
        ctxAny.font = font(s, weight);
      }

      ctxAny.textAlign = 'right';
      ctxAny.textBaseline = 'alphabetic';
      ctxAny.fillStyle = 'rgba(255,255,255,' + alpha + ')';

      // 双层阴影：远处扩散保证亮背景可读，近处收紧让字边锐利
      ctxAny.shadowColor = 'rgba(0,0,0,0.55)';
      ctxAny.shadowBlur = s * 0.55;
      ctxAny.shadowOffsetY = s * 0.06;
      ctxAny.fillText(text, W - pad, y);

      ctxAny.shadowBlur = s * 0.12;
      ctxAny.shadowOffsetY = 0;
      ctxAny.fillText(text, W - pad, y);

      ctxAny.shadowColor = 'transparent';
      ctxAny.shadowBlur = 0;
    }

    ctx.save();

    var y = H - pad;

    if (line2) {
      drawLine(line2, base * 0.92, 400, y, 0.95);
      y -= base * 0.92 + gap;
    }

    if (line1) {
      drawLine(line1, base * 1.06, 600, y, 1);
    }

    ctx.restore();
  }

  function collectMeta() {
    return {
      model: el.fModel.value.trim(),
      when: el.fWhen.value.trim(),
      place: el.fPlace.value.trim(),
      params: el.fParams.value.trim()
    };
  }

  function readOptions() {
    return {
      showParams: el.optParams.checked,
      showPlace: el.optPlace.checked,
      sizeScale: Number(el.optSize.value) / 100
    };
  }

  /* ============================== 预览 ============================== */

  var rafId = 0;

  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = 0;
      drawPreview();
    });
  }

  function drawPreview() {
    if (!state.bitmap) return;

    var c = el.preview;
    var scale = Math.min(1, MAX_PREVIEW / Math.max(state.width, state.height));

    var pw = Math.max(1, Math.round(state.width * scale));
    var ph = Math.max(1, Math.round(state.height * scale));

    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }

    var ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);

    // 白底，避免透明 PNG 在浅色页面里糊成一片
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pw, ph);

    ctx.save();
    ctx.scale(scale, scale);
    ctx.drawImage(state.bitmap, 0, 0, state.width, state.height);
    drawWatermark(ctx, state.width, state.height, collectMeta(), readOptions());
    ctx.restore();
  }

  /* ============================== 地点解析 ============================== */

  /* ------------------------- 模式一：Worker 代理 ------------------------- */

  async function fetchPlaceViaWorker(lat, lon) {
    var url = WORKER_URL + '/?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);
    var resp;

    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: ctrl.signal,
        cache: 'default'
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) throw new Error('http-' + resp.status);

    var data = await resp.json();
    if (!data || !data.ok) {
      throw new Error((data && data.error) || 'bad-response');
    }
    return data;
  }

  /* --------------------- 模式二：浏览器直连天地图 --------------------- */
  /*
   * 天地图网关统一返回 Access-Control-Allow-Origin: *，浏览器可以直接调，
   * 不需要代理。代价是 key 会出现在前端源码里，只能靠天地图的
   * 「浏览器端 key + 域名白名单」限制别人在其他网站复用。
   *
   * 下面的解析逻辑要和 worker/worker.js 里的 extractPlace 保持一致，
   * 改一处记得同步另一处。
   */

  function splitAddr(addr) {
    var rest = String(addr || '').trim();
    var province = '';
    var city = '';
    var district = '';
    if (!rest) return { province: province, city: city, district: district };

    var muni = rest.match(/^(北京市|上海市|天津市|重庆市)/);
    if (muni) {
      province = muni[1];
      city = muni[1];
      rest = rest.slice(muni[1].length);
    } else {
      var mp = rest.match(/^(.{2,8}?(?:省|自治区|特别行政区))/);
      if (mp) {
        province = mp[1];
        rest = rest.slice(mp[1].length);
      }
    }

    var mc = rest.match(/^(.{2,10}?(?:市|自治州|地区|盟))/);
    if (mc) {
      city = city || mc[1];
      rest = rest.slice(mc[1].length);
    }

    var md = rest.match(/^(.{2,10}?(?:区|县|旗|市))/);
    if (md) district = md[1];

    return { province: province, city: city, district: district };
  }

  function pickPoi(poi, city, district) {
    var p = String(poi || '').trim();
    if (!p || p === city || p === district) return '';
    if (p.length > 12) return '';
    if (/^[\d\s\-]+$/.test(p)) return '';
    if (/(路|街|道|巷|弄|胡同|大道)/.test(p) && /\d+\s*号?$/.test(p)) return '';
    return p;
  }

  function extractPlaceLite(d) {
    var loc = (d && d.location) || {};
    var res = (d && d.result) || {};
    var ac = res.addressComponent || {};

    var city = ac.city || ac.province || '';
    var district = ac.county || ac.district || '';
    var poi = ac.poi || ac.town || ac.village || loc.keyWord || '';
    var formatted = res.formatted_address || loc.address || '';

    if (!city && formatted) {
      var sp = splitAddr(formatted);
      city = sp.city || sp.province || '';
      district = district || sp.district;
    }

    if (district === city) district = '';
    poi = pickPoi(poi, city, district);

    var place = '';
    if (city && poi) place = city + ' · ' + poi;
    if (!place || place.length > 16) {
      var admin = (city || '') + (district && district !== city ? district : '');
      place = admin || formatted || poi;
    }

    return { place: place || formatted || poi, address: formatted };
  }

  async function requestTdt(type, lat, lon) {
    var post = JSON.stringify({ lon: lon, lat: lat, ver: 1 });
    var url = 'https://api.tianditu.gov.cn/geocoder?postStr=' +
      encodeURIComponent(post) + '&type=' + type + '&tk=' + encodeURIComponent(TDT_KEY);

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);
    var resp;

    try {
      resp = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 403) throw new Error('tdt-forbidden');

    var text = await resp.text();
    var d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      throw new Error('tdt-not-json');
    }

    var msg = String((d && (d.msg || d.message)) || '');
    if (/key|密钥|权限/i.test(msg)) throw new Error('tdt-key-rejected');

    return d;
  }

  async function fetchPlaceDirect(lat, lon) {
    // 和 Worker 一样，regeocode 拿不到就退回 geocode
    var types = ['regeocode', 'geocode'];

    for (var i = 0; i < types.length; i++) {
      var d = await requestTdt(types[i], lat, lon);
      var info = extractPlaceLite(d);
      if (info.place) {
        return { ok: true, place: info.place, address: info.address, cached: false };
      }
    }

    throw new Error('tdt-no-result');
  }

  async function fetchPlace(lat, lon) {
    if (WORKER_URL) return fetchPlaceViaWorker(lat, lon);
    return fetchPlaceDirect(lat, lon);
  }

  async function resolvePlace(manual) {
    if (!state.gps) {
      setPlaceStatus('无 GPS', 'warn');
      if (manual) notice('这张照片的 EXIF 里没有 GPS 坐标，请手动填写地点。', 'warn');
      return;
    }

    if (!WORKER_URL && !TDT_KEY) {
      setPlaceStatus('未配置', 'warn');
      if (manual) {
        notice('还没有配置地点服务。在 assets/config.js 里填 workerUrl（推荐）或 tdtKey（直连），二选一。', 'warn');
      }
      return;
    }

    setPlaceStatus('定位中…');
    el.btnRegeo.disabled = true;

    try {
      var d = await fetchPlace(state.gps.latitude, state.gps.longitude);
      var name = d.place || d.address || '';
      if (name) {
        el.fPlace.value = name;
        setPlaceStatus(d.cached ? '已解析 · 缓存' : '已解析', 'ok');
        notice('');
        scheduleRender();
      } else {
        setPlaceStatus('无结果', 'warn');
        if (manual) notice('天地图在这个坐标没有返回可用的地名，可以手动填写。', 'warn');
      }
    } catch (e) {
      var code = String(e && e.message || e);
      var msg = '地点解析失败';

      if (e && e.name === 'AbortError') msg = '地点解析超时';
      else if (code === 'tdt-forbidden') msg = '天地图拒绝了请求，检查 key 的域名白名单是否包含当前域名';
      else if (code === 'tdt-key-rejected') msg = '天地图 key 无效或未开通逆地理编码服务';
      else if (code === 'tdt-no-result') msg = '这个坐标没有匹配到地名';
      else if (code === 'tdt-not-json') msg = '天地图返回了非 JSON 内容（可能被限流）';
      else if (code === 'http-403') msg = 'Worker 拒绝了请求（Origin 白名单没放行当前域名）';
      else if (code === 'http-429') msg = '请求过于频繁，稍后再试';
      else if (code.indexOf('http-5') === 0) msg = '地点服务暂时不可用';
      else if (e && e.name === 'TypeError' && WORKER_URL) {
        // fetch 抛 TypeError / 被 AbortController 之外的网络错误 → 连不上
        msg = '连不上 Worker 地址。如果它是 *.workers.dev 结尾，国内网络访问会一直超时（该域名被封锁），'
            + '请改用直连模式（填 tdtKey），或给 Worker 绑定自己的域名';
      }

      setPlaceStatus('失败', 'err');
      if (manual) notice(msg + '，可以手动填写地点。', 'err');
      console.warn('[place]', e);
    } finally {
      el.btnRegeo.disabled = !state.gps;
    }
  }

  /* ============================== 文件处理 ============================== */

  function setBusy(busy) {
    el.btnDownload.disabled = busy || !state.bitmap;
    el.btnReset.disabled = busy || !state.bitmap;
  }

  async function handleFile(file) {
    if (!file) return;

    if (!/^image\//.test(file.type || '') && !isHeic(file)) {
      notice('这不是图片文件，请选择 JPG / PNG / WebP / HEIC 照片。', 'err');
      return;
    }

    notice('');
    setPlaceStatus('');

    // EXIF 解析和图像解码并行：HEIC 解码要一两秒，没必要串着等
    var exifPromise = parseExif(file).catch(function () { return null; });

    var img;
    try {
      img = await decodeImage(file, function (stage) {
        if (stage === 'loading-lib') {
          notice('正在加载 HEIC 解码器（首次约 2 MB，之后走浏览器缓存）…');
        }
      });
    } catch (e) {
      var reason = String((e && e.message) || e);

      if (isHeic(file)) {
        if (reason === 'libheif-load-failed') {
          notice('HEIC 解码器下载失败，请检查网络后重试；也可以先把照片导出为 JPG。', 'err');
        } else if (reason === 'heic-no-image' || reason === 'heic-display-failed') {
          notice('这张 HEIC 解不出来，可能是 10-bit HDR 或特殊编码。用系统相册导出成 JPG 再试。', 'err');
        } else {
          notice('HEIC 解码失败，可以先用系统相册导出为 JPG 再试。', 'err');
        }
      } else {
        notice('这张图片无法解码，可能已损坏或使用了浏览器不支持的编码。', 'err');
      }
      return;
    }

    state.file = file;
    state.bitmap = img;
    state.width = img.width || img.naturalWidth;
    state.height = img.height || img.naturalHeight;
    state.fileName = (file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
    state.gps = null;

    if (!state.width || !state.height) {
      notice('读不到图片尺寸，请换一张试试。', 'err');
      return;
    }

    // 读取 EXIF
    var exif = await exifPromise;
    var hasExif = !!exif;

    el.fModel.value = hasExif ? cleanModel(exif.Make, exif.Model) : '';
    el.fWhen.value = hasExif ? fmtWhen(exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate) : '';
    el.fParams.value = hasExif ? fmtParams(exif) : '';
    el.fPlace.value = '';
    state.gps = hasExif ? readGps(exif) : null;

    el.dropzone.hidden = true;
    el.canvasBox.hidden = false;
    el.btnReset.disabled = false;
    el.btnDownload.disabled = false;
    el.btnRegeo.disabled = !state.gps;

    // 预览先出来，地点异步补
    drawPreview();

    if (!hasExif) {
      notice('这张图没有 EXIF 信息（可能被社交软件压缩过），机型和地点需要手动填写。', 'warn');
      setPlaceStatus('无 EXIF', 'warn');
      return;
    }

    if (!el.fModel.value && !el.fWhen.value) {
      notice('EXIF 里没有相机型号和拍摄时间，可以手动填写。', 'warn');
    }

    if (state.gps) {
      setPlaceStatus('解析中…');
      resolvePlace(false);
    } else {
      setPlaceStatus('无 GPS', 'warn');
      notice('EXIF 里没有 GPS 坐标（可能是拍摄时关闭了定位），地点需要手动填写。', 'warn');
    }
  }

  /* ============================== 导出 ============================== */

  function exportImage() {
    if (!state.bitmap) return;

    var W = state.width;
    var H = state.height;

    // Safari / iOS 的 canvas 面积上限较低，超大图给一句提示
    if (W * H > 80e6) {
      notice('这张图分辨率极高（' + W + '×' + H + '），浏览器可能无法导出，若失败请先缩小尺寸。', 'warn');
    }

    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;

    var ctx = canvas.getContext('2d');
    if (!ctx) {
      notice('浏览器无法创建画布，请换一个浏览器试试。', 'err');
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(state.bitmap, 0, 0, W, H);
    drawWatermark(ctx, W, H, collectMeta(), readOptions());

    var done = function (blob) {
      if (!blob) {
        notice('导出失败：图片太大，浏览器内存不足。建议先缩小尺寸。', 'err');
        return;
      }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = state.fileName + '-watermark.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      notice('已导出 ' + W + '×' + H + ' 的水印照片。', '');
    };

    try {
      canvas.toBlob(done, 'image/jpeg', JPEG_QUALITY);
    } catch (e) {
      notice('导出失败：' + (e && e.message ? e.message : '未知错误'), 'err');
    }
  }

  /* ============================== 事件绑定 ============================== */

  function pickFile() {
    el.fileInput.value = '';
    el.fileInput.click();
  }

  el.dropzone.addEventListener('click', pickFile);

  el.dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickFile();
    }
  });

  el.fileInput.addEventListener('change', function () {
    if (this.files && this.files[0]) handleFile(this.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (t) {
    el.dropzone.addEventListener(t, function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (t) {
    el.dropzone.addEventListener(t, function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.dropzone.classList.remove('dragover');
    });
  });

  el.dropzone.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
  });

  // 整页拖拽时不要让浏览器直接打开图片
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  [el.fModel, el.fWhen, el.fPlace, el.fParams].forEach(function (input) {
    input.addEventListener('input', function () {
      if (input === el.fPlace) {
        // 手动改过地点就不再显示解析状态
        if (el.fPlace.value.trim()) setPlaceStatus('', '');
      }
      scheduleRender();
    });
  });

  [el.optParams, el.optPlace].forEach(function (box) {
    box.addEventListener('change', scheduleRender);
  });

  el.optSize.addEventListener('input', function () {
    el.sizeLabel.textContent = el.optSize.value + '%';
    scheduleRender();
  });

  el.btnDownload.addEventListener('click', exportImage);

  el.btnReset.addEventListener('click', function () {
    state.file = null;
    state.bitmap = null;
    state.gps = null;
    if (el.preview.getContext) {
      var ctx = el.preview.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, el.preview.width, el.preview.height);
      el.preview.width = 0;
      el.preview.height = 0;
    }
    el.canvasBox.hidden = true;
    el.dropzone.hidden = false;
    el.fModel.value = '';
    el.fWhen.value = '';
    el.fPlace.value = '';
    el.fParams.value = '';
    el.btnDownload.disabled = true;
    el.btnReset.disabled = true;
    el.btnRegeo.disabled = true;
    setPlaceStatus('', '');
    notice('');
  });

  el.btnRegeo.addEventListener('click', function () {
    resolvePlace(true);
  });

  /* ============================== 启动自检 ============================== */

  (function boot() {
    el.btnRegeo.disabled = true;

    if (!WORKER_URL && !TDT_KEY) {
      el.netState.textContent = '地点服务未配置';
      el.netState.className = 'err';
      return;
    }

    // 直连模式不主动探测，免得白烧一次配额
    if (!WORKER_URL) {
      el.netState.textContent = '直连天地图';
      el.netState.className = 'ok';
      return;
    }

    fetch(WORKER_URL + '/health', { method: 'GET' })
      .then(function (r) {
        if (!r.ok) throw new Error('http-' + r.status);
        return r.json();
      })
      .then(function (d) {
        el.netState.textContent = d && d.ok ? '地点服务可用' : '地点服务异常';
        el.netState.className = d && d.ok ? 'ok' : 'err';
      })
      .catch(function () {
        el.netState.textContent = '地点服务连接失败';
        el.netState.className = 'err';
      });
  })();

})();
