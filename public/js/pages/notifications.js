import { h, put, icon, toast } from '../dom.js';
import { btn, emptyState } from '../ui.js';
import { S, api } from '../state.js';
import { orgUrl, loadUnread } from '../session.js';

export async function render(root, go) {
  const list = (await api('GET', orgUrl('/notifications'))).notifications;
  const mark = async (ids) => { await api('POST', orgUrl('/notifications/read'), { ids }); await loadUnread(); go('notifications', true); };
  const unread = list.filter((n) => !n.read);
  put(root, h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, 'Notifications'), h('p', { class: 'sub' }, 'Things that need attention, worked out from your actual records.')),
    h('div', { class: 'head-actions' }, btn('Mark all as read', { ic: 'check', disabled: !unread.length, onclick: () => mark(unread.map((n) => n.id)) }))),
    h('div', { class: 'card' }, list.length ? h('ul', { class: 'list' }, list.map((n) => h('li', {}, h('span', { class: `dotmark ${n.read ? '' : n.level === 'warn' ? 'warn' : 'ok'}` }),
      h('div', { class: 'grow-1' }, h('b', {}, n.title), n.read ? h('span', { class: 'muted' }, ' · read') : null, h('div', { class: 'muted' }, n.body)),
      h('div', { class: 'row-tight' }, btn('Open', { size: 'sm', onclick: async () => { if (!n.read) await api('POST', orgUrl('/notifications/read'), { ids: [n.id] }); await loadUnread(); go(n.link === 'footprint' ? 'footprint?tab=waste' : n.link); } }), n.read ? null : btn('Dismiss', { size: 'sm', kind: 'ghost', onclick: () => mark([n.id]) })))))
      : emptyState({ icon: 'bell', title: 'You are all caught up', body: 'New items appear here when documents need review or records are missing.' })));
  void S; void icon; void toast;
}
