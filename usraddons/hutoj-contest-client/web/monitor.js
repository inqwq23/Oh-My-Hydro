(() => {
  const root = document.querySelector('#hutoj-monitor');
  if (!root || root.dataset.initialized) {
    return;
  }
  root.dataset.initialized = 'true';
  const endpoint = root.dataset.endpoint;
  const csrf = root.dataset.csrf;
  const video = root.querySelector('video');
  const alert = root.querySelector('[role="alert"]');
  const button = (name) => root.querySelector(`[data-action="${name}"]`);
  const notices = root.querySelector('[data-offline-notices]');
  const openedAt = Number(root.dataset.openedAt);
  const announced = new Map();
  const desktop = window.isSecureContext && window.Notification;
  if (desktop && desktop.permission === 'default') {
    button('notify').hidden = false;
  }
  button('notify').addEventListener('click', async () => {
    try {
      await desktop.requestPermission();
    } finally {
      button('notify').hidden = true;
    }
  });
  function announceDisconnects(clients) {
    for (const client of clients) {
      if (
        !client.offlineAt ||
        Date.parse(client.offlineAt) < openedAt ||
        announced.get(client.uid) === client.offlineAt
      ) {
        continue;
      }
      announced.set(client.uid, client.offlineAt);
      const text = `选手${client.name}已掉线，系统已自动结束该选手的比赛。`;
      const line = document.createElement('p');
      line.textContent = text;
      notices.prepend(line);
      if (notices.children.length > 30) {
        notices.lastElementChild.remove();
      }
      if (desktop && desktop.permission === 'granted') {
        try {
          new desktop('比赛掉线通知', {
            body: text,
            tag: `${endpoint}/${client.uid}/${client.offlineAt}`,
          });
        } catch {
          /* The page notice remains visible. */
        }
      }
    }
  }
  let selected = null;
  let clients = [];
  let peer = null;
  let viewerId = null;
  let heartbeat = null;
  let generation = 0;
  let recordings = [];
  const errors = {
    SCREEN_OFFLINE: '该选手当前没有可用的实时画面。',
    MEDIA_SERVICE_UNAVAILABLE: '无法连接媒体服务。',
    PLAYBACK_NOT_CONFIGURED: '尚未配置录像回放服务。',
    RECORDING_UNAVAILABLE: '该段录像暂时无法播放。',
    MONITOR_TEMPLATE_REQUIRED: '监控地址模板需包含比赛域、比赛、选手和会话。',
    MONITOR_WHIP_PATH_REQUIRED: '当前媒体地址不支持 WHEP 实时查看。',
  };
  const showError = (error) => {
    alert.textContent = errors[error.message] || error.message;
    alert.hidden = false;
  };
  function drawDevice() {
    const panel = root.querySelector('.monitor-device');
    panel.hidden = !selected;
    root.querySelector('.monitor-name').textContent = selected?.name || '';
    for (const field of ['system', 'ip']) {
      panel.querySelector(`[data-device="${field}"]`).textContent =
        selected?.deviceInfo?.[field] || '—';
    }
  }
  async function request(query = '', body) {
    const response = await fetch(`${endpoint}${query}`, {
      credentials: 'same-origin',
      method: body ? 'POST' : 'GET',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify({ ...body, csrf }) : undefined,
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error?.params?.[0] || '监控请求失败。');
    }
    return data;
  }
  async function stop() {
    generation++;
    clearInterval(heartbeat);
    heartbeat = null;
    peer?.close();
    peer = null;
    video.pause();
    video.srcObject = null;
    video.removeAttribute('src');
    video.load();
    button('stop').disabled = true;
    const id = viewerId;
    viewerId = null;
    if (id) {
      await request('', { action: 'stop', id }).catch(() => {});
    }
  }
  function drawClients() {
    const list = root.querySelector('.monitor-clients');
    list.replaceChildren();
    if (!clients.length) {
      const text = document.createElement('p');
      text.textContent = '暂无客户端连接';
      list.append(text);
    }
    for (const client of clients) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `monitor-client${client.uid === selected?.uid ? ' selected' : ''}`;
      const name = document.createElement('strong');
      name.textContent = client.name;
      const status = document.createElement('span');
      status.textContent = `${client.online ? '在线' : '离线'}${client.violations ? ` · ${client.violations} 条违规` : ''}`;
      element.append(name, status);
      if (client.environmentWarning?.forced) {
        status.textContent += ' · 全屏警告';
      }
      if (client.offlineAt && client.offlineAt === client.endAt) {
        status.textContent = '掉线 · 已结束比赛';
      }
      element.addEventListener('click', async () => {
        await stop();
        selected = client;
        drawDevice();
        button('live').disabled = !client.online;
        button('recordings').disabled = false;
        button('events').disabled = false;
        button('clear-warning').hidden = !client.environmentWarning?.forced;
        root.querySelector('.monitor-events').hidden = true;
        root.querySelector('[data-replay]').hidden = true;
        alert.hidden = true;
        drawClients();
      });
      list.append(element);
    }
  }
  async function refresh() {
    const data = await request();
    clients = data.clients;
    announceDisconnects(clients);
    drawClients();
    if (selected) {
      selected = clients.find((client) => client.uid === selected.uid) || selected;
      drawDevice();
      button('live').disabled = !selected.online;
      button('clear-warning').hidden = !selected.environmentWarning?.forced;
      if (!root.querySelector('.monitor-events').hidden) {
        await showEvents();
      }
    }
  }
  async function showEvents() {
    if (!selected) {
      return;
    }
    const uid = selected.uid;
    const data = await request(`?events=${uid}`);
    if (selected?.uid !== uid) {
      return;
    }
    const panel = root.querySelector('.monitor-events');
    const list = panel.querySelector('ul');
    list.replaceChildren();
    for (const issue of data.environmentWarning?.issues || []) {
      const item = document.createElement('li');
      item.textContent = `检测到${selected.name}使用违规${issue.kind === 'plugin' ? '插件' : '应用'}“${issue.name}”`;
      list.append(item);
    }
    for (const event of data.events) {
      const item = document.createElement('li');
      const application =
        event.description && event.description !== event.name
          ? `${event.description}（${event.name}）`
          : event.name;
      item.textContent = `${new Date(event.at).toLocaleString('zh-CN', { hour12: false })} · 检测到${selected.name}运行违规应用“${application}”`;
      list.append(item);
    }
    for (const event of data.environmentEvents || []) {
      const item = document.createElement('li');
      item.textContent = `${new Date(event.at).toLocaleString('zh-CN', { hour12: false })} · 检测到${selected.name}使用违规${event.kind === 'plugin' ? '插件' : '应用'}“${event.name}”`;
      list.append(item);
    }
    if (
      !data.events.length &&
      !data.environmentEvents?.length &&
      !data.environmentWarning?.issues?.length
    ) {
      const item = document.createElement('li');
      item.textContent = '暂无进程违规记录';
      list.append(item);
    }
    panel.hidden = false;
  }
  button('events').addEventListener('click', () => {
    alert.hidden = true;
    void showEvents().catch(showError);
  });
  button('clear-warning').addEventListener('click', async () => {
    if (!selected?.environmentWarning?.forced) {
      return;
    }
    button('clear-warning').disabled = true;
    try {
      await request('', {
        action: 'clear-warning',
        uid: selected.uid,
        warningId: selected.environmentWarning.id,
      });
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      button('clear-warning').disabled = false;
    }
  });
  button('refresh').addEventListener('click', () => {
    alert.hidden = true;
    void refresh().catch(showError);
  });
  button('stop').addEventListener('click', () => void stop());
  button('live').addEventListener('click', async () => {
    if (!selected) {
      return;
    }
    button('live').disabled = true;
    alert.hidden = true;
    await stop();
    const current = generation;
    try {
      const connection = new RTCPeerConnection({ iceServers: [] });
      peer = connection;
      connection.addTransceiver('video', { direction: 'recvonly' });
      connection.ontrack = (event) => {
        if (current === generation) {
          video.srcObject = event.streams[0] || new MediaStream([event.track]);
          void video.play().catch(showError);
        }
      };
      connection.onconnectionstatechange = () => {
        if (
          current === generation &&
          ['failed', 'disconnected'].includes(connection.connectionState)
        ) {
          void stop();
          showError(new Error('实时连接已断开。'));
        }
      };
      await connection.setLocalDescription(await connection.createOffer());
      await new Promise((resolve, reject) => {
        if (connection.iceGatheringState === 'complete') {
          resolve();
          return;
        }
        const timer = setTimeout(() => {
          connection.removeEventListener('icegatheringstatechange', check);
          reject(new Error('实时连接准备超时。'));
        }, 10000);
        function check() {
          if (connection.iceGatheringState === 'complete') {
            clearTimeout(timer);
            connection.removeEventListener('icegatheringstatechange', check);
            resolve();
          }
        }
        connection.addEventListener('icegatheringstatechange', check);
      });
      if (current !== generation) {
        return;
      }
      const answer = await request('', {
        action: 'watch',
        uid: selected.uid,
        sdp: connection.localDescription.sdp,
      });
      if (current !== generation) {
        await request('', { action: 'stop', id: answer.id });
        return;
      }
      viewerId = answer.id;
      await connection.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      heartbeat = setInterval(
        () =>
          request('', { action: 'keepalive', id: viewerId }).catch((error) => {
            void stop();
            showError(error);
          }),
        20000,
      );
      button('stop').disabled = false;
      root.querySelector('[data-replay]').hidden = true;
    } catch (error) {
      if (current === generation) {
        await stop();
        showError(error);
      }
    } finally {
      button('live').disabled = !selected?.online;
    }
  });
  button('recordings').addEventListener('click', async () => {
    if (!selected) {
      return;
    }
    alert.hidden = true;
    const uid = selected.uid;
    try {
      const data = await request(`?recordings=${uid}`);
      if (selected?.uid !== uid) {
        return;
      }
      recordings = data.recordings;
      const select = root.querySelector('[aria-label="录像时间"]');
      select.replaceChildren();
      recordings.forEach((record, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = `${new Date(record.start).toLocaleString()} · ${Math.round(record.duration)} 秒`;
        select.append(option);
      });
      root.querySelector('[data-replay]').hidden = !recordings.length;
      if (!recordings.length) {
        showError(new Error('暂无可回放录像。'));
      }
    } catch (error) {
      showError(error);
    }
  });
  button('play').addEventListener('click', async () => {
    const record = recordings[Number(root.querySelector('[aria-label="录像时间"]').value)];
    if (!record) {
      return;
    }
    await stop();
    alert.hidden = true;
    video.src = record.url;
    button('stop').disabled = false;
    void video.play().catch(showError);
  });
  video.addEventListener('error', () => {
    if (video.hasAttribute('src')) {
      showError(new Error('RECORDING_UNAVAILABLE'));
    }
  });
  let polling = false;
  const refreshTimer = setInterval(async () => {
    if (polling) {
      return;
    }
    polling = true;
    try {
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      polling = false;
    }
  }, 5000);
  window.addEventListener(
    'pagehide',
    () => {
      clearInterval(refreshTimer);
      clearInterval(heartbeat);
      peer?.close();
      if (viewerId) {
        navigator.sendBeacon(
          endpoint,
          new Blob([JSON.stringify({ action: 'stop', id: viewerId, csrf })], {
            type: 'application/json',
          }),
        );
      }
    },
    { once: true },
  );
  void refresh().catch(showError);
})();
