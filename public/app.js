'use strict';

/* =========================================================
 * 多人旅游记账 APP —— 联网共享版 前端逻辑
 * - 数据保存在服务端 SQLite（所有人共享同一份）
 * - 每个设备有独立身份（userId + 昵称，存 localStorage）
 * - 通过「邀请码 / 邀请链接」加入同一行程
 * - 每个人创建自己的角色；记支出时默认付款人=自己，也可选别人
 * ========================================================= */

const LS_UID = 'ta_online_uid';
const LS_NAME = 'ta_online_name';
const LS_JOINED = 'ta_online_joined';

// ----------------------------- 基础存储
function getUid() {
  let uid = localStorage.getItem(LS_UID);
  if (!uid) {
    uid = (crypto.randomUUID && crypto.randomUUID()) ||
      ('u' + Date.now() + Math.random().toString(16).slice(2));
    localStorage.setItem(LS_UID, uid);
  }
  return uid;
}
function getName() { return localStorage.getItem(LS_NAME) || ''; }
function setName(n) { localStorage.setItem(LS_NAME, n); }

function getJoined() {
  try { return JSON.parse(localStorage.getItem(LS_JOINED)) || []; }
  catch { return []; }
}
function saveJoined(list) { localStorage.setItem(LS_JOINED, JSON.stringify(list)); }

function getEntry(tripId) {
  return getJoined().find((e) => e.tripId === Number(tripId)) || null;
}
function upsertEntry(entry) {
  const list = getJoined();
  const i = list.findIndex((e) => e.tripId === Number(entry.tripId));
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.unshift(entry);
  saveJoined(list);
}

// ----------------------------- 网络请求
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.msg || ('请求失败 ' + res.status));
  return data.data;
}

// ----------------------------- 轻提示 / 弹窗
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function modal(title, bodyHtml, actions) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const box = document.getElementById('modal-actions');
  box.innerHTML = '';
  (actions || [{ label: '知道了', primary: true }]).forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-outline');
    b.textContent = a.label;
    b.onclick = () => { closeModal(); a.onClick && a.onClick(); };
    box.appendChild(b);
  });
  document.getElementById('modal').style.display = 'flex';
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

function inputModal(title, placeholder, onOk, opts) {
  opts = opts || {};
  modal(
    title,
    `<input id="modal-input" class="input" placeholder="${placeholder}" value="${opts.value || ''}" />`,
    [
      { label: '取消', primary: false },
      {
        label: opts.okText || '确定', primary: true, onClick: () => {
          const v = document.getElementById('modal-input').value.trim();
          if (opts.required && !v) { toast('内容不能为空'); return; }
          onOk(v);
        }
      }
    ]
  );
  setTimeout(() => { const i = document.getElementById('modal-input'); if (i) i.focus(); }, 50);
}

// ----------------------------- 身份
function ensureIdentity() {
  return new Promise((resolve) => {
    if (getName()) return resolve();
    modal(
      '先告诉我你的名字',
      `<p style="margin:0 0 4px">用于标记「你」的角色，方便默认付款人是你自己。</p>
       <input id="modal-input" class="input" placeholder="例如：张三" />`,
      [
        {
          label: '开始使用', primary: true, onClick: () => {
            const v = document.getElementById('modal-input').value.trim();
            if (!v) { toast('请输入名字'); return; }
            setName(v); resolve();
          }
        }
      ]
    );
    setTimeout(() => { const i = document.getElementById('modal-input'); if (i) i.focus(); }, 50);
  });
}

// ----------------------------- 视图切换
function showView(id) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

let currentTrip = null; // { trip, members, expenses }

// ----------------------------- 首页
async function renderHome() {
  const me = getName();
  document.getElementById('home-me').textContent = me ? ('我是 ' + me) : '';
  const list = getJoined();
  const box = document.getElementById('trip-list');
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">还没有行程，新建一个或输入邀请码加入吧</div>';
    return;
  }
  box.innerHTML = '';
  list.forEach((e) => {
    const div = document.createElement('div');
    div.className = 'trip-item';
    div.innerHTML = `
      <div>
        <div class="t-name">${esc(e.name)}</div>
        <div class="t-meta">邀请码 ${e.code}${e.memberId ? ' · 已建角色' : ' · 待建角色'}</div>
      </div>
      <div class="t-arrow">›</div>`;
    div.onclick = () => openTrip(e.tripId);
    box.appendChild(div);
  });
}

function showNewTrip() {
  ensureIdentity().then(() => {
    inputModal('新建行程', '如：2026年8月云南之旅', async (name) => {
      try {
        const trip = await api('POST', '/trips', { name });
        // 自动为创建者建立自己的角色
        const mem = await api('POST', `/trips/${trip.id}/members`, { name: getName(), created_by: getUid() });
        upsertEntry({ tripId: trip.id, code: trip.code, name: trip.name, memberId: mem.id });
        toast('行程已创建，邀请码 ' + trip.code);
        openTrip(trip.id);
      } catch (err) { toast(err.message); }
    }, { required: true, okText: '创建' });
  });
}

async function joinByCode() {
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!code) { toast('请输入邀请码'); return; }
  await doJoin(code);
}

async function doJoin(code) {
  try {
    const trip = await api('GET', '/trips/code/' + code);
    const existing = getEntry(trip.id);
    if (existing) {
      upsertEntry({ ...existing, code: trip.code, name: trip.name });
    } else {
      upsertEntry({ tripId: trip.id, code: trip.code, name: trip.name, memberId: undefined });
    }
    toast('已加入：' + trip.name);
    openTrip(trip.id);
  } catch (err) { toast(err.message); }
}

function goHome() { renderHome(); showView('view-home'); }

// ----------------------------- 行程详情
async function openTrip(tripId) {
  try {
    currentTrip = await api('GET', '/trips/' + tripId);
    renderTrip();
    showView('view-trip');
  } catch (err) { toast(err.message); }
}

function renderTrip() {
  const { trip, members, expenses } = currentTrip;
  document.getElementById('trip-name').textContent = trip.name;
  document.getElementById('trip-code').textContent = trip.code;
  document.getElementById('member-count').textContent = members.length;
  document.getElementById('expense-count').textContent = expenses.length;

  const entry = getEntry(trip.id);
  const myId = entry && entry.memberId;

  // 成员列表
  const mbox = document.getElementById('member-list');
  mbox.innerHTML = '';
  if (members.length === 0) {
    mbox.innerHTML = '<div class="empty">还没有成员</div>';
  }
  members.forEach((m) => {
    const div = document.createElement('div');
    const isMe = (m.id === myId);
    div.className = 'member-item' + (isMe ? ' me' : '');
    div.innerHTML = `
      <div><span class="m-name">${esc(m.name)}</span>${isMe ? '<span class="m-tag">我</span>' : ''}</div>
      <span class="m-del" data-del-member="${m.id}">删除</span>`;
    mbox.appendChild(div);
  });
  mbox.querySelectorAll('[data-del-member]').forEach((el) => {
    el.onclick = () => deleteMember(Number(el.getAttribute('data-del-member')));
  });

  // 我的角色区
  const roleBox = document.getElementById('my-role-box');
  if (!myId) {
    roleBox.innerHTML = `<p class="role-hint">你还没有在此行程中建立角色，先创建你的角色才能记账。</p>
      <button class="btn btn-primary btn-block btn-sm" onclick="UI.createMyRole()">创建我的角色（${esc(getName())}）</button>`;
    document.getElementById('btn-add-expense').disabled = true;
    document.getElementById('btn-add-expense').textContent = '先创建角色';
  } else {
    roleBox.innerHTML = '';
    document.getElementById('btn-add-expense').disabled = false;
    document.getElementById('btn-add-expense').textContent = '记一笔';
  }

  // 支出列表
  const ebox = document.getElementById('expense-list');
  ebox.innerHTML = '';
  if (expenses.length === 0) {
    ebox.innerHTML = '<div class="empty">还没有支出记录</div>';
  }
  const nameMap = {};
  members.forEach((m) => { nameMap[m.id] = m.name; });
  expenses.forEach((e) => {
    const div = document.createElement('div');
    div.className = 'expense-item';
    const shareNames = (e.sharers || []).map((id) => nameMap[id] || '?').join('、');
    div.innerHTML = `
      <div class="e-top">
        <span class="e-note">${esc(e.note || '未备注')}</span>
        <span class="e-amount">¥${fmt(e.amount)}</span>
      </div>
      <div class="e-meta">${esc(nameMap[e.payer_id] || '?')} 付 · ${esc(e.pay_method)} · ${esc(e.paid_at)}</div>
      <div class="e-sharers">分摊：${esc(shareNames)}（每人 ¥${fmt(e.amount / (e.sharers ? e.sharers.length : 1))}）</div>
      <span class="e-del" data-del-exp="${e.id}">删除</span>`;
    ebox.appendChild(div);
  });
  ebox.querySelectorAll('[data-del-exp]').forEach((el) => {
    el.onclick = () => deleteExpense(Number(el.getAttribute('data-del-exp')));
  });
}

function createMyRole() {
  const entry = getEntry(currentTrip.trip.id);
  if (entry && entry.memberId) return;
  api('POST', `/trips/${currentTrip.trip.id}/members`, { name: getName(), created_by: getUid() })
    .then((mem) => {
      upsertEntry({ tripId: currentTrip.trip.id, code: currentTrip.trip.code, name: currentTrip.trip.name, memberId: mem.id });
      toast('角色已创建');
      openTrip(currentTrip.trip.id);
    })
    .catch((err) => toast(err.message));
}

function addMember() {
  inputModal('添加成员', '成员姓名', async (name) => {
    try {
      await api('POST', `/trips/${currentTrip.trip.id}/members`, { name, created_by: getUid() });
      toast('已添加 ' + name);
      openTrip(currentTrip.trip.id);
    } catch (err) { toast(err.message); }
  }, { required: true, okText: '添加' });
}

async function deleteMember(id) {
  const entry = getEntry(currentTrip.trip.id);
  if (entry && entry.memberId === id) {
    toast('不能删除自己的角色（可先删除其支出）');
    return;
  }
  try {
    await api('DELETE', '/members/' + id);
    toast('成员已删除');
    openTrip(currentTrip.trip.id);
  } catch (err) { toast(err.message); }
}

async function deleteExpense(id) {
  try {
    await api('DELETE', '/expenses/' + id);
    toast('支出已删除');
    openTrip(currentTrip.trip.id);
  } catch (err) { toast(err.message); }
}

function showTripMenu() {
  modal('行程操作', `<p style="margin:0">${esc(currentTrip.trip.name)}</p>`, [
    {
      label: '重命名', primary: false, onClick: () => {
        inputModal('重命名行程', '新名称', async (name) => {
          try { await api('PUT', '/trips/' + currentTrip.trip.id, { name }); toast('已重命名'); openTrip(currentTrip.trip.id); }
          catch (err) { toast(err.message); }
        }, { required: true, value: currentTrip.trip.name });
      }
    },
    {
      label: '删除行程', primary: false, onClick: () => {
        modal('确认删除', '<p style="margin:0">将删除该行程下所有成员与支出，且不可恢复。</p>', [
          { label: '取消', primary: false },
          {
            label: '删除', primary: true, onClick: async () => {
              try {
                await api('DELETE', '/trips/' + currentTrip.trip.id);
                const list = getJoined().filter((e) => e.tripId !== currentTrip.trip.id);
                saveJoined(list);
                toast('行程已删除');
                goHome();
              } catch (err) { toast(err.message); }
            }
          }
        ]);
      }
    },
    { label: '关闭', primary: true }
  ]);
}

function copyLink() {
  const code = currentTrip.trip.code;
  const link = location.origin + '/?code=' + code;
  const text = '【多人旅游记账】行程「' + currentTrip.trip.name + '」邀请码：' + code + '，链接：' + link;
  copyText(text).then(() => toast('邀请链接已复制，去发给同伴吧')).catch(() => toast(text));
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); resolve();
    } catch (e) { reject(e); }
  });
}

// ----------------------------- 记一笔
function showExpense() {
  const { members } = currentTrip;
  const entry = getEntry(currentTrip.trip.id);
  const myId = entry && entry.memberId;

  // 付款人（默认自己）
  const payerSel = document.getElementById('exp-payer');
  payerSel.innerHTML = '';
  members.forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.name + (m.id === myId ? '（我）' : '');
    payerSel.appendChild(o);
  });
  payerSel.value = myId || (members[0] && members[0].id);

  // 时间默认现在
  document.getElementById('exp-time').value = nowLocal();
  document.getElementById('exp-method').value = '微信';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-note').value = '';

  // 分摊人（默认全部勾选）
  const sbox = document.getElementById('exp-sharers');
  sbox.innerHTML = '';
  members.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'check-item checked';
    div.dataset.id = m.id;
    div.innerHTML = `<div class="box">✓</div><div class="c-name">${esc(m.name)}${m.id === myId ? '（我）' : ''}</div>`;
    div.onclick = () => {
      div.classList.toggle('checked');
      div.querySelector('.box').textContent = div.classList.contains('checked') ? '✓' : '';
    };
    sbox.appendChild(div);
  });

  document.getElementById('expense-title').textContent = '记一笔';
  showView('view-expense');
}

async function saveExpense() {
  const payer_id = Number(document.getElementById('exp-payer').value);
  const paid_at = document.getElementById('exp-time').value.replace('T', ' ');
  const pay_method = document.getElementById('exp-method').value;
  const amount = parseFloat(document.getElementById('exp-amount').value);
  const note = document.getElementById('exp-note').value.trim();
  const sharer_ids = Array.from(document.querySelectorAll('#exp-sharers .check-item.checked')).map((el) => Number(el.dataset.id));

  if (!(amount > 0)) { toast('金额必须大于 0'); return; }
  if (sharer_ids.length === 0) { toast('请至少选择一名分摊人员'); return; }

  try {
    await api('POST', `/trips/${currentTrip.trip.id}/expenses`, { payer_id, paid_at, pay_method, amount, note, sharer_ids });
    toast('已保存');
    openTrip(currentTrip.trip.id);
  } catch (err) { toast(err.message); }
}

function backFromExpense() { goTrip(); }
function goTrip() { if (currentTrip) { renderTrip(); showView('view-trip'); } else goHome(); }

// ----------------------------- 结算
async function showSettle() {
  try {
    const r = await api('GET', `/trips/${currentTrip.trip.id}/settle`);
    const entry = getEntry(currentTrip.trip.id);
    const myId = entry && entry.memberId;
    document.getElementById('settle-name').textContent = '结算清单 · ' + r.tripName;

    const sbox = document.getElementById('settle-summary');
    sbox.innerHTML = '';
    r.summary.forEach((s) => {
      const div = document.createElement('div');
      div.className = 'sum-item' + (s.id === myId ? ' me' : '');
      div.innerHTML = `
        <div>
          <div class="s-name">${esc(s.name)}${s.id === myId ? '（我）' : ''}</div>
          <div class="s-sub">付 ¥${fmt(s.paid)} · 摊 ¥${fmt(s.share)}</div>
        </div>
        <div class="s-role ${s.role}">${s.role === '平衡' ? '已平' : (s.role + ' ¥' + fmt(Math.abs(s.net)))}</div>`;
      sbox.appendChild(div);
    });

    const tbox = document.getElementById('settle-trans');
    tbox.innerHTML = '';
    if (r.transactions.length === 0) {
      tbox.innerHTML = '<div class="empty">账目已平，不需要转账 🎉</div>';
    }
    r.transactions.forEach((t) => {
      const div = document.createElement('div');
      div.className = 'trans-item';
      div.innerHTML = `
        <span class="t-from">${esc(t.fromName)}</span>
        <span class="trans-arrow">→</span>
        <span class="t-to">${esc(t.toName)}</span>
        <span class="t-amt">¥${fmt(t.amount)}</span>`;
      tbox.appendChild(div);
    });

    showView('view-settle');
  } catch (err) { toast(err.message); }
}

// ----------------------------- 工具
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function fmt(n) {
  const v = Number(n) || 0;
  return (Math.round(v * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function nowLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ----------------------------- 暴露给 HTML onclick
window.UI = {
  showNewTrip, joinByCode, doJoin, goHome, openTrip, createMyRole, addMember,
  showExpense, saveExpense, backFromExpense, showSettle, goTrip, copyLink, showTripMenu
};

// ----------------------------- 启动
(async function init() {
  await ensureIdentity();
  renderHome();
  showView('view-home');

  // 支持通过邀请链接直接进入
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) {
    document.getElementById('join-code').value = code;
    doJoin(code.toUpperCase());
  }
})();
