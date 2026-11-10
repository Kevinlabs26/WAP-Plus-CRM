(() => {
  if (window.__wapMuse?.version === 7) return;
  let job = null;
  const originOK = () => location.origin === 'https://muse.ai';
  const bubbles = () => {
    const selector = 'div[class*="hatch-chat-groupable-bubble"]';
    const nodes = [...document.querySelectorAll(selector)], all = new Set(nodes);
    return nodes.filter(node => { let parent = node.parentElement; while (parent) { if (all.has(parent)) return false; parent = parent.parentElement; } return true; });
  };
  const isAgent = node => /hatch-agent-bubble-bg/.test(node.className || '');
  const isUser = node => /hatch-user-bubble-bg/.test(node.className || '');
  const threadPath = path => /^\/thread\/[A-Za-z0-9_-]{1,200}$/.test(path) && path !== '/thread/new';
  const ownerMarker = owner => `WAP conversation ID: ${owner}`;
  const messageText = node => node.innerText || node.textContent || '';
  const matches = (id, path, owner) => originOK() && (path
    ? threadPath(path) && location.pathname === path && typeof owner === 'string' && /^[a-f0-9]{64}$/.test(owner)
      && bubbles().some(node => !isAgent(node) && messageText(node).includes(ownerMarker(owner)))
    : location.pathname === '/thread/new' && new URLSearchParams(location.search).get('wapRequest') === id && !bubbles().length);
  const stop = () => [...document.querySelectorAll('[data-testid="hatch-composer-stop-button"],button[aria-label*="Stop" i],button[aria-label*="停止"]')].find(node => node.offsetParent !== null && !node.hidden && node.getAttribute?.('aria-hidden') !== 'true');
  const input = () => {
    const fields = [...document.querySelectorAll('textarea')].filter(node => node.offsetParent !== null);
    return fields.length === 1 ? fields[0] : null;
  };
  const imageFileInput = () => {
    const fields = [...document.querySelectorAll('input[type="file"]')];
    const images = fields.filter(node => /image|\.(?:png|jpe?g|webp)/i.test(node.getAttribute('accept') || ''));
    return images.length === 1 ? images[0] : !images.length && fields.length === 1 ? fields[0] : null;
  };
  const attachmentSnapshot = () => {
    let root = input()?.parentElement;
    for (let depth = 0; root?.parentElement && depth < 6; depth++) {
      const parent = root.parentElement;
      if (parent === document.body || parent.querySelectorAll('textarea').length !== 1 || parent.querySelectorAll('div[class*="hatch-chat-groupable-bubble"]').length) break;
      root = parent;
    }
    if (!root) return null;
    const visible = node => node.isConnected !== false && node.offsetParent !== null;
    const label = node => `${node.getAttribute('aria-label') || ''} ${node.getAttribute('title') || ''} ${node.getAttribute('data-testid') || ''} ${node.innerText || ''}`;
    return {
      root,
      images: [...root.querySelectorAll('img')].filter(node => visible(node) && (node.currentSrc || node.src)),
      removes: [...root.querySelectorAll('button,[role="button"]')].filter(node => visible(node) && /remove|delete|dismiss.*(?:file|image|attachment)|移除|删除|取消.*(?:图片|附件)|retirer|supprimer/i.test(label(node))),
      named: ['bridgecrm-reference.jpg', 'bridgecrm-style.jpg'].filter(name => (root.innerText || '').includes(name)).length,
      busy: [...root.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].some(visible),
      errors: [...root.querySelectorAll('[role="alert"]')].filter(visible).map(node => (node.innerText || '').trim()).filter(Boolean),
    };
  };
  const referencePreview = () => {
    const snapshot = attachmentSnapshot();
    if (!snapshot || !job?.attachmentBaseline) return null;
    const images = snapshot.images.filter(node => !job.attachmentBaseline.sources.has(node.currentSrc || node.src));
    const removes = snapshot.removes.filter(node => !job.attachmentBaseline.removes.has(node));
    const matching = job.referenceSources ? images.filter(node => job.referenceSources.includes(node.currentSrc || node.src)) : images;
    const count = job.uploadedCount || 1;
    return removes.length === count && (matching.length === count || !images.length && snapshot.named === count)
      ? { sources: matching.map(node => node.currentSrc || node.src), removes, busy: snapshot.busy } : null;
  };
  const clearReference = () => {
    if (job?.reference) {
      const preview = referencePreview();
      if (preview) { for (const remove of [...preview.removes].reverse()) { try { remove.click(); } catch {} } }
    }
    const field = imageFileInput();
    if (['bridgecrm-reference.jpg', 'bridgecrm-style.jpg'].includes(field?.files?.[0]?.name)) {
      try { field.files = new DataTransfer().files; field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    }
  };
  const send = () => {
    const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(node => node.offsetParent !== null
      && /^(?:send(?:\b|$)|发送|傳送|envoyer(?:\b|$))/i.test(node.getAttribute('aria-label') || node.getAttribute('data-testid')?.replace(/^hatch-composer-/, '').replace(/-button$/, '') || node.innerText || ''));
    return buttons.length === 1 ? buttons[0] : null;
  };
  function notice() {
    let text = document.body?.innerText || '';
    for (const bubble of bubbles()) { const content = bubble.innerText || ''; if (content) text = text.split(content).join(' '); }
    return text.slice(-6000);
  }
  function inspect(id, path = null, owner = null) {
    if (!originOK()) return { state: 'login', error: '请在 Muse 窗口完成登录' };
    const text = notice();
    // Quota labels and upgrade instructions describe limits without reporting exhaustion.
    const exhausted = text.split(/\n+/).some(line => {
      const message = line.trim();
      return /^(?:(?:you(?:['’]ve| have)? )?(?:reached|hit|exceeded) (?:your |the )?(?:(?:daily|weekly|monthly|free|usage|token) )*limit\b|(?:you(?:['’]re| are) )?out of credits\b|insufficient credits\b|(?:usage|token) limit (?:reached|exceeded)\b)/i.test(message)
        || /^(?:(?:您|你)?(?:已)?用完(?:本周|每周|本月|今日|免费)?(?:使用)?额度|(?:(?:您|你)的)?(?:本周|每周|本月|今日|免费)?(?:使用)?(?:额度|积分|余额)(?:已)?(?:不足|用完|耗尽)|(?:您|你)?已达到(?:本周|每周|本月|今日|免费)?(?:使用)?上限)(?:[，。！？：:\s]|$)/.test(message);
    });
    if (exhausted) return { state: 'quota', error: 'Muse 网页提示额度不足，请在 Muse 窗口查看' };
    if (stop()) return { state: 'busy', error: 'Muse 正在生成，请稍后重试' };
    const hydration = document.querySelector('[data-hatch-shell-hydration-state]');
    if (hydration && hydration.getAttribute('data-hatch-shell-hydration-state') !== 'hydrated') return { state: 'loading', error: 'Muse 正在恢复后台连接，请稍候' };
    if (input() && !/Connecting\.\.\.|正在连接|正在预热|warming up/i.test(text)) return { state: 'ready', ...(id ? { matched: matches(id, path, owner) } : {}) };
    if (!input() && /log in|sign in|create an account|登录|use another account/i.test(text)) return { state: 'login', error: '请先登录 Muse 网页版' };
    return { state: 'loading', error: 'Muse 页面尚未连接就绪' };
  }
  const result = () => ({ state: job.state, requestId: job.id, diagnostic: { phase: job.phase || job.state, responseNodes: job.responseNodes || 0, mediaLocated: !!job.mediaSrc, mediaPending: !!job.mediaPending, stopVisible: !!stop() }, ...(job.sent ? { sent: true } : {}), ...(job.seenUser && job.path ? { path: job.path } : {}), ...(job.state === 'done' ? { text: job.text, ...(job.mediaData ? { media: job.mediaData } : {}) } : {}), ...(job.error ? { error: job.error } : {}) });
  const fail = error => { if (job) { if (!job.sent) clearReference(); job.state = 'error'; job.error = error; delete job.prompt; return result(); } return { state: 'error', error }; };
  const ourUser = node => !isAgent(node) && messageText(node).includes(`WAP request ID: ${job.id}`)
    && (!job.owner || messageText(node).includes(ownerMarker(job.owner)));
  const mediaCandidate = node => {
    for (const video of node.tagName === 'VIDEO' ? [node] : node.querySelectorAll('video')) {
      const src = video.currentSrc || video.src || video.querySelector('source')?.src;
      if (src) return { src, video: true };
    }
    for (const image of node.tagName === 'IMG' ? [node] : node.querySelectorAll('img')) {
      const src = image.currentSrc || image.src;
      if (Math.max(image.naturalWidth || 0, image.width || 0) >= 128 && Math.max(image.naturalHeight || 0, image.height || 0) >= 128 && src) return { src, video: false };
    }
    for (const link of node.tagName === 'A' && node.hasAttribute('download') ? [node] : node.querySelectorAll('a[download][href]')) {
      const name = link.getAttribute('download') || new URL(link.href, location.href).pathname;
      if (/\.(?:png|jpe?g|webp|mp4|webm)$/i.test(name)) return { src: link.href, video: /\.(?:mp4|webm)$/i.test(name) };
    }
    return null;
  };
  const siblingMedia = (anchor, response, nextUser) => {
    const firstReply = response.find(isAgent);
    if (!firstReply?.parentElement || !firstReply.compareDocumentPosition) return null;
    let root = firstReply.parentElement;
    while (root && !root.contains(anchor)) root = root.parentElement;
    if (!root || root === document.body) return null;
    const composer = attachmentSnapshot()?.root;
    const nodes = [...root.querySelectorAll('img,video,a[download][href]')].filter(node =>
      (firstReply.contains(node) || firstReply.compareDocumentPosition(node) & 4)
      && (!nextUser || node.compareDocumentPosition(nextUser) & 4)
      && !node.closest('[class*="hatch-user-bubble-bg"]') && !composer?.contains(node));
    return nodes.map(mediaCandidate).find(Boolean) || null;
  };
  const dataBlob = dataUrl => {
    const match = /^data:(image\/(?:png|jpeg|webp)|video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match || match[2].length > (match[1].startsWith('video/') ? 22_400_000 : 11_200_000)) throw new Error('图片或视频数据无效或过大');
    return new Blob([Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))], { type: match[1] });
  };
  const readMedia = async candidate => {
    const limit = candidate.video ? 16 * 1024 * 1024 : 8 * 1024 * 1024;
    const url = new URL(candidate.src, location.href);
    if (!['blob:', 'data:'].includes(url.protocol) && (url.protocol !== 'https:' || ![location.hostname, 'muse.ai', 'www.muse.ai'].includes(url.hostname) && !['.muse.ai', '.fbcdn.net', '.fbsbx.com'].some(suffix => url.hostname.endsWith(suffix)))) throw new Error(`Muse 媒体来源不受支持（${url.hostname}）`);
    let blob;
    if (url.protocol === 'data:') blob = dataBlob(url.href);
    else {
      let response;
      try { response = await fetch(url.href, { credentials: url.hostname === location.hostname ? 'include' : 'omit', signal: AbortSignal.timeout(30_000) }); }
      catch { throw new Error(`Muse 图片或视频下载失败（${url.hostname || '本页临时媒体'}）：网页跨域限制或网络连接异常`); }
      if (!response.ok) throw new Error(`无法读取 Muse 媒体文件（HTTP ${response.status}）`);
      if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new Error('Muse 媒体文件超过大小限制');
      }
      if (!response.body) throw new Error('Muse 媒体文件没有响应数据流');
      const reader = response.body.getReader(), chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > limit) throw new Error('Muse 媒体文件超过大小限制');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      blob = new Blob(chunks, { type: response.headers.get('content-type') || (candidate.video ? 'video/mp4' : 'image/png') });
    }
    if (!blob.size || blob.size > limit) throw new Error('Muse 媒体文件超过大小限制');
    const mimeType = (blob.type || (candidate.video ? 'video/mp4' : 'image/png')).split(';')[0].toLowerCase();
    if (candidate.video ? !['video/mp4', 'video/webm'].includes(mimeType) : !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error(`Muse 返回了不支持的媒体格式（${mimeType}）`);
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('读取 Muse 媒体失败'));
      reader.onerror = () => reject(new Error('读取 Muse 媒体失败'));
      reader.readAsDataURL(blob);
    });
    return { mimeType, dataUrl };
  };
  function start(id, prompt, path = null, owner = null, reference = null, expectMedia = false) {
    const references = Array.isArray(reference) ? reference : reference ? [reference] : [];
    if (references.length > 2) return { state: 'error', error: '最多使用两张图片，未发送' };
    reference = references.length ? references : null;
    if (!matches(id, path, owner)) return { state: 'error', error: 'Muse 未进入对应客户的对话，未发送内容' };
    if (inspect().state !== 'ready') return inspect();
    if (job && !['done','error'].includes(job.state)) return { state: 'error', error: 'Muse 当前请求尚未结束' };
    if (typeof prompt !== 'string' || !prompt.trim() || [...prompt].length > 110000) return { state: 'error', error: 'Muse 提示词为空或超过长度限制' };
    if (input()?.value.trim()) return { state: 'error', error: 'Muse 输入框有未发送内容，请先处理草稿' };
    const fileField = reference ? imageFileInput() : null;
    if (reference && (!fileField || fileField.files?.length)) return { state: 'error', error: 'Muse 没有唯一可用的图片附件入口，或草稿已有附件；未发送' };
    const attachments = reference ? attachmentSnapshot() : null;
    if (reference && (!attachments || attachments.removes.length && (attachments.images.length || attachments.named))) return { state: 'error', error: 'Muse 输入区已有附件或无法确认附件区域，请先处理草稿；未发送' };
    const marked = `${owner ? ownerMarker(owner)+'\n' : ''}WAP request ID: ${id}\n\n${prompt}`;
    job = { id, prompt: marked, owner, path, reference: !!reference, expectMedia: !!expectMedia, sent: false, seenUser: false, state: reference ? 'attaching' : 'preparing', deadline: Date.now()+(reference ? 30_000 : 5000), text: '', changed: Date.now(), attachmentBaseline: attachments ? { sources: new Set(attachments.images.map(node => node.currentSrc || node.src)), removes: new Set(attachments.removes), errors: new Set(attachments.errors) } : null };
    if (reference) {
      try {
        job.referenceFiles = references.map((item, index) => {
          const image = dataBlob(item.dataUrl);
          if (image.type !== item.mimeType || !image.size || image.size > 3 * 1024 * 1024) throw new Error('Muse 参考图片无效或过大');
          return new File([image], index ? 'bridgecrm-style.jpg' : 'bridgecrm-reference.jpg', { type: item.mimeType });
        });
        job.uploadedCount = fileField.multiple === false ? 1 : job.referenceFiles.length;
        const transfer = new DataTransfer();
        for (const file of job.referenceFiles.slice(0, job.uploadedCount)) transfer.items.add(file);
        fileField.files = transfer.files;
        fileField.dispatchEvent(new Event('input', { bubbles: true }));
        fileField.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) { return fail(`Muse 参考图上传失败：${String(error)}；本次未发送`); }
      return { state: job.state };
    }
    try {
      const field = input();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!field || !setter) return fail('Muse 输入框不可用');
      setter.call(field, marked);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return { state: job.state };
    } catch { return fail('无法填入 Muse 输入框，未重试'); }
  }
  function poll(id) {
    if (!originOK() || !job || job.id !== id) return { state: 'error', error: 'Muse 页面已切换或刷新，本次生成已中止' };
    if (job.path && location.pathname !== job.path) return fail('Muse 页面已切换，本次回复未取用');
    if (['done','error'].includes(job.state)) return result();
    const status = inspect();
    if (['login','quota'].includes(status.state)) return fail(status.error);
    if (job.state === 'attaching') {
      if (!matches(id, job.path, job.owner) || input()?.value.trim()) return fail('Muse 页面或草稿已变化，未发送');
      const error = attachmentSnapshot()?.errors.find(text => !job.attachmentBaseline.errors.has(text));
      if (error) return fail(`Muse 参考图上传失败：${error.slice(0, 240)}；本次未发送`);
      const preview = referencePreview();
      if (!preview || preview.busy) {
        if (Date.now() > job.deadline) return fail('Muse 输入区未出现可用的参考图预览，请在 Muse 窗口查看上传结果；本次未发送');
        return result();
      }
      if (job.uploadedCount < job.referenceFiles.length) {
        const field = imageFileInput();
        if (!field) return fail('Muse 第二张图片的上传入口不可用，未发送');
        const transfer = new DataTransfer();
        transfer.items.add(job.referenceFiles[job.uploadedCount]);
        job.uploadedCount++;
        field.files = transfer.files;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        job.deadline = Date.now()+30_000;
        return result();
      }
      const field = input();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!field || !setter) return fail('Muse 输入框不可用');
      setter.call(field, job.prompt);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      job.referenceSources = preview.sources;
      delete job.referenceFiles;
      job.state = 'preparing';
      job.deadline = Date.now() + 5000;
    }
    if (job.state === 'preparing') {
      if (!matches(id, job.path, job.owner) || input()?.value !== job.prompt) return fail('Muse 客户对话或输入内容已变化，未发送');
      if (job.reference) {
        const preview = referencePreview();
        if (!preview) return fail('Muse 参考图预览已消失，未发送');
        if (preview.busy) {
          if (Date.now() > job.deadline) return fail('Muse 参考图仍在上传，请在 Muse 窗口查看；本次未发送');
          return result();
        }
      }
      const button = send();
      if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        job.state = 'generating';
        job.sent = true;
        job.mediaDeadline = Date.now() + 180_000;
        try { button.click(); } catch { return fail('Muse 发送结果不明，未重复发送'); }
        job.seenUser = bubbles().some(ourUser);
        if (job.seenUser && !job.path && threadPath(location.pathname)) job.path = location.pathname;
      } else if (Date.now() > job.deadline) return fail('Muse 发送按钮尚未就绪，未发送');
      return result();
    }
    const entries = bubbles(), index = entries.findLastIndex(ourUser);
    if (index < 0) {
      job.phase = 'locating-request';
      job.missingSince ??= Date.now();
      if (Date.now()-job.missingSince > 15_000) return fail('Muse 暂时无法定位本次请求，请打开原对话后取回图片；未重复生成');
      return result();
    }
    delete job.missingSince;
    job.seenUser = true;
    if (!job.path && threadPath(location.pathname)) job.path = location.pathname;
    const following = entries.slice(index+1);
    const nextUser = following.findIndex(isUser);
    const response = nextUser < 0 ? following : following.slice(0, nextUser);
    job.responseNodes = response.length;
    const replies = response.filter(isAgent);
    const parts = replies.flatMap(node => [...node.querySelectorAll('.prose')]);
    const text = parts.map(node => node.innerText || '').join('\n\n').trim();
    if (text.length > 32000) return fail('Muse 回复过长，未取用');
    if (text !== job.text) { job.text = text; job.changed = Date.now(); }
    const candidate = [...response].reverse().map(mediaCandidate).find(Boolean) || siblingMedia(entries[index], response, nextUser < 0 ? null : following[nextUser]);
    job.phase = job.mediaPending ? 'reading-media' : job.mediaData ? 'waiting-for-completion' : candidate ? 'media-located' : 'waiting-for-media';
    if (candidate && candidate.src !== job.mediaSrc && !job.mediaPending && !job.mediaData) { job.mediaSrc = candidate.src; job.mediaError = null; }
    if (candidate && !stop() && !job.mediaData && !job.mediaPending && !job.mediaError) {
      const currentJob = job;
      job.mediaPending = true;
      job.phase = 'reading-media';
      job.mediaReadStarted = Date.now();
      job.changed = Date.now();
      void readMedia(candidate).then(media => { if (job === currentJob) { job.mediaData = media; job.changed = Date.now(); } }).catch(error => { if (job === currentJob) { job.mediaError = String(error); job.changed = Date.now(); } }).finally(() => { if (job === currentJob) job.mediaPending = false; });
    }
    const settled = !job.mediaPending && !stop() && status.state === 'ready' && Date.now()-job.changed >= 1800;
    if (job.mediaPending && Date.now()-job.mediaReadStarted > 35_000) return fail('Muse 图片已定位，但读取附件超时；原图仍保留在 Muse，未重新生成');
    if (settled && job.mediaError && (job.expectMedia || !text)) return fail(`Muse 媒体读取失败：${job.mediaError}；原结果仍保留在 Muse，未重复生成`);
    if (settled && (job.mediaData || text && !job.expectMedia)) { job.state = 'done'; delete job.prompt; clearReference(); }
    else if (job.expectMedia && !job.mediaData && !job.mediaPending && Date.now() >= job.mediaDeadline) return fail(job.collecting ? '取回超时：已定位原对话，但未在本次回复范围内识别到可读取的图片；原图保留在 Muse，未重新生成' : text ? 'Muse 已回复文字，但等待图片或视频超时；请在 Muse 窗口查看原结果，未重复生成' : 'Muse 尚未返回图片或视频；请在 Muse 窗口查看原结果，未重复生成');
    return result();
  }
  function recover(id) {
    if (!job || job.id !== id || !job.seenUser || job.state !== 'error') return { state: 'error', error: '没有可恢复的 Muse 生成结果' };
    job.state = 'generating';
    delete job.error;
    job.mediaError = null;
    job.mediaPending = false;
    return poll(id);
  }
  function collect() {
    if (!originOK() || !threadPath(location.pathname)) return { state: 'error', error: '请在 Muse 窗口打开刚才已生成图片的对话，再点“取回 Muse 图片”' };
    if (job && !['done','error'].includes(job.state)) return { state: 'error', error: 'Muse 当前请求尚未结束，请稍后取回' };
    const entry = [...bubbles()].reverse().find(node => isUser(node) && /WAP request ID:\s*[a-f0-9-]{36}/i.test(messageText(node)));
    const id = entry && /WAP request ID:\s*([a-f0-9-]{36})/i.exec(messageText(entry))?.[1];
    if (!id) return { state: 'error', error: '当前 Muse 对话没有本软件的生成记录，请打开刚才的原对话；不会重新生成' };
    job = { id, path: location.pathname, owner: null, reference: false, expectMedia: true, collecting: true, sent: true, seenUser: true, state: 'generating', mediaDeadline: Date.now()+30_000, text: '', changed: Date.now() };
    return poll(id);
  }
  function cancel(id) {
    if (job?.id === id && !['done','error'].includes(job.state)) {
      try { stop()?.click(); } catch {}
      fail('已取消 Muse 生成');
    }
  }
  window.__wapMuse = { version: 7, inspect, start, poll, recover, collect, cancel };
})();
