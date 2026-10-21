(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var CP = window.CP || {};

  function toast(msg, type) {
    var t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function modal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.add('on'); }
  function closeModal() { $('#modal').classList.remove('on'); }
  function api(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({'X-CSRF': CP.csrf, 'X-Requested-With': 'fetch'}, opts.headers || {});
    opts.credentials = 'same-origin';
    return fetch(url, opts).then(function (r) { return r.json(); });
  }

  // 主题
  var tb = $('#themeBtn');
  if (tb) tb.onclick = function () {
    var n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = n; localStorage.setItem('cp-theme', n);
  };

  // 弹窗
  var m = $('#modal');
  if (m) {
    m.addEventListener('click', function (e) { if (e.target === m || e.target.hasAttribute('data-close')) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  }

  document.addEventListener('click', function (e) {
    var el;
    // 确认
    if ((el = e.target.closest('[data-confirm]')) && !el.hasAttribute('data-post')) {
      if (!confirm(el.getAttribute('data-confirm'))) { e.preventDefault(); e.stopPropagation(); return; }
    }
    // 日志详情
    if ((el = e.target.closest('[data-log]')) && !e.target.closest('input,button')) {
      e.preventDefault();
      api('/?a=log_detail&id=' + el.getAttribute('data-log')).then(function (d) { modal(d.html); });
      return;
    }
    // POST 动作
    if ((el = e.target.closest('[data-post]'))) {
      e.preventDefault();
      if (el.hasAttribute('data-confirm') && !confirm(el.getAttribute('data-confirm'))) return;
      var f = document.createElement('form');
      f.method = 'post'; f.action = el.getAttribute('data-post');
      f.innerHTML = '<input type="hidden" name="_csrf" value="' + CP.csrf + '">';
      document.body.appendChild(f); f.submit();
      return;
    }
    // 立即执行
    if ((el = e.target.closest('[data-run]'))) {
      e.preventDefault();
      var id = el.getAttribute('data-run');
      el.disabled = true; el.classList.add('spin');
      var fd = new FormData(); fd.append('_csrf', CP.csrf); fd.append('id', id);
      api('/?a=run&id=' + id, {method: 'POST', body: fd}).then(function (d) {
        el.disabled = false; el.classList.remove('spin');
        if (!d.ok) return toast(d.error, 'bad');
        var r = d.result;
        toast(r.ok ? ('执行成功 · HTTP ' + r.code + ' · ' + r.ms) : ('执行失败：' + r.error), r.ok ? 'ok' : 'bad');
        setTimeout(function () { location.reload(); }, el.hasAttribute('data-reload') ? 700 : 1200);
      }).catch(function () { el.disabled = false; el.classList.remove('spin'); toast('请求失败', 'bad'); });
      return;
    }
    // 复制
    if ((el = e.target.closest('[data-copy]'))) {
      var txt = el.getAttribute('data-copy');
      var done = function () { toast('已复制', 'ok'); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done);
      else { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
    }
  });

  // 批量选择
  var all = $('#ckAll');
  if (all) {
    var bar = $('.bulkbar'), cnt = $('#selCount');
    var upd = function () {
      var n = $$('input[name="ids[]"]:checked').length;
      bar.hidden = n === 0; cnt.textContent = n;
    };
    all.onchange = function () { $$('input[name="ids[]"]').forEach(function (c) { c.checked = all.checked; }); upd(); };
    $$('input[name="ids[]"]').forEach(function (c) { c.onchange = upd; });
  }

  // 倒计时
  var skew = CP.now ? CP.now * 1000 - Date.now() : 0;
  function rel(at) {
    var d = Math.round(at - (Date.now() + skew) / 1000);
    if (d <= 0) return '即将执行';
    if (d < 60) return d + ' 秒后';
    if (d < 3600) return Math.floor(d / 60) + ' 分 ' + (d % 60) + ' 秒后';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时 ' + Math.floor(d % 3600 / 60) + ' 分后';
    return Math.floor(d / 86400) + ' 天后';
  }
  var cds = $$('.cd[data-at]');
  if (cds.length) setInterval(function () { cds.forEach(function (c) { c.textContent = rel(+c.getAttribute('data-at')); }); }, 1000);

  // 列表/概览页：有任务到点时自动刷新状态
  if (cds.length && !$('#jobForm')) {
    setInterval(function () {
      var now = (Date.now() + skew) / 1000;
      var due = cds.some(function (c) { var t = +c.getAttribute('data-at'); return t < now - 8 && t > now - 20; });
      if (due && !document.hidden && !$('#modal.on') && !$$('input[name="ids[]"]:checked').length) location.reload();
    }, 5000);
  }

  // 标签页
  $$('.tabs [data-tab]').forEach(function (b) {
    b.onclick = function () {
      $$('.tabs [data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
      $$('.tab-pane').forEach(function (p) { p.classList.toggle('on', p.id === b.getAttribute('data-tab')); });
    };
  });

  // ---------- 执行计划构建器 ----------
  var cronIn = $('#cronInput');
  if (cronIn) {
    var tzIn = $('#tzInput'), pv = $('#cronPreview'), timer;
    var pad = function (n) { return ('0' + n).slice(-2); };
    var hm = function (v) { var p = (v || '00:00').split(':'); return [parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0]; };
    function setMode(mode, keep) {
      $$('.sched-modes a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-mode') === mode); });
      $$('.sched-body [data-pane]').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === mode); });
      cronIn.readOnly = mode !== 'custom';
      if (!keep) build(mode);
    }
    function build(mode) {
      var c = cronIn.value;
      if (mode === 'minutes') { var n = $('#sMin').value; c = n === '1' ? '* * * * *' : '*/' + n + ' * * * *'; }
      if (mode === 'hourly') { var e = $('#sHourEvery').value; c = (parseInt($('#sHourMin').value, 10) || 0) + ' ' + (e === '1' ? '*' : '*/' + e) + ' * * *'; }
      if (mode === 'daily') {
        var ts = $('#sDailyTimes').value.split(/[,，\s]+/).filter(Boolean).map(hm);
        if (!ts.length) ts = [[0, 0]];
        c = ts[0][1] + ' ' + ts.map(function (t) { return t[0]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; }).join(',') + ' * * *';
      }
      if (mode === 'weekly') {
        var d = $$('#sWeekDays input:checked').map(function (i) { return i.value; });
        var t = hm($('#sWeekTime').value);
        c = t[1] + ' ' + t[0] + ' * * ' + (d.length ? d.join(',') : '*');
      }
      if (mode === 'monthly') { var t2 = hm($('#sMonthTime').value); c = t2[1] + ' ' + t2[0] + ' ' + ($('#sMonthDays').value.replace(/[，\s]+/g, ',') || '1') + ' * *'; }
      cronIn.value = c;
      preview();
    }
    function detect(c) {
      var p = c.trim().split(/\s+/), m;
      if (p.length !== 5) return 'custom';
      if (c === '* * * * *') { $('#sMin').value = '1'; return 'minutes'; }
      if ((m = p[0].match(/^\*\/(\d+)$/)) && p.slice(1).join(' ') === '* * * *' && $('#sMin option[value="' + m[1] + '"]')) { $('#sMin').value = m[1]; return 'minutes'; }
      if (/^\d+$/.test(p[0]) && p.slice(2).join(' ') === '* * *') {
        if (p[1] === '*' || /^\*\/\d+$/.test(p[1])) {
          var ev = p[1] === '*' ? '1' : p[1].slice(2);
          if ($('#sHourEvery option[value="' + ev + '"]')) { $('#sHourEvery').value = ev; $('#sHourMin').value = p[0]; return 'hourly'; }
        }
        if (/^[\d,]+$/.test(p[1])) { $('#sDailyTimes').value = p[1].split(',').map(function (h) { return pad(h) + ':' + pad(p[0]); }).join(', '); return 'daily'; }
      }
      if (/^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && p[2] === '*' && p[3] === '*' && /^[\d,]+$/.test(p[4])) {
        $$('#sWeekDays input').forEach(function (i) { i.checked = p[4].split(',').indexOf(i.value) >= 0; });
        $('#sWeekTime').value = pad(p[1]) + ':' + pad(p[0]); return 'weekly';
      }
      if (/^\d+$/.test(p[0]) && /^\d+$/.test(p[1]) && /^[\d,]+$/.test(p[2]) && p[3] === '*' && p[4] === '*') {
        $('#sMonthDays').value = p[2]; $('#sMonthTime').value = pad(p[1]) + ':' + pad(p[0]); return 'monthly';
      }
      return 'custom';
    }
    function preview() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        api('/?a=cron_preview&cron=' + encodeURIComponent(cronIn.value) + '&tz=' + encodeURIComponent(tzIn.value)).then(function (d) {
          pv.classList.toggle('bad', !d.ok);
          $('b', pv).textContent = d.ok ? d.desc + '，接下来执行时间：' : '表达式有误：' + d.error;
          $('ol', pv).innerHTML = d.ok ? d.next.map(function (t) { return '<li>' + t + '</li>'; }).join('') : '';
        });
      }, 250);
    }
    $$('.sched-modes a').forEach(function (a) { a.onclick = function () { setMode(a.getAttribute('data-mode')); }; });
    $$('.sched-body input, .sched-body select').forEach(function (i) {
      i.addEventListener('input', function () { var on = $('.sched-modes a.on'); if (on) build(on.getAttribute('data-mode')); });
      i.addEventListener('change', function () { var on = $('.sched-modes a.on'); if (on) build(on.getAttribute('data-mode')); });
    });
    cronIn.addEventListener('input', preview);
    tzIn.addEventListener('change', preview);
    setMode(detect(cronIn.value), true);
    preview();

    // 测试运行
    $('#testBtn').onclick = function () {
      var b = this, f = $('#jobForm');
      b.disabled = true; b.lastChild.textContent = '请求中…';
      var url = f.action.replace('a=save_job', 'a=test');
      api(url, {method: 'POST', body: new FormData(f)}).then(function (d) {
        b.disabled = false; b.lastChild.textContent = '测试运行';
        if (!d.ok) return toast(d.error, 'bad');
        modal(d.html);
      }).catch(function () { b.disabled = false; b.lastChild.textContent = '测试运行'; toast('请求失败', 'bad'); });
    };
  }

  // SMTP 预设
  $$('[data-smtp]').forEach(function (a) {
    a.onclick = function () {
      var p = a.getAttribute('data-smtp').split('|'), f = $('#mailForm');
      f.smtp_host.value = p[0]; f.smtp_port.value = p[1]; f.smtp_secure.value = p[2]; f.mail_mode.value = 'smtp';
      toast('已填入 ' + a.textContent + ' 配置，记得填写账号与授权码');
    };
  });
  var mt = $('#mailTestBtn');
  if (mt) mt.onclick = function () {
    var fd = new FormData(); fd.append('_csrf', CP.csrf); fd.append('to', $('#testTo').value);
    mt.disabled = true;
    api('/?a=mail_test', {method: 'POST', body: fd}).then(function (d) {
      mt.disabled = false;
      var out = $('#mailTestOut'); out.hidden = false;
      out.textContent = (d.ok ? '✓ 发送成功，请查收（也可能在垃圾箱）' : '✗ 发送失败：' + d.error) + (d.debug ? '\n\n' + d.debug : '');
      toast(d.ok ? '测试邮件已发送' : '发送失败', d.ok ? 'ok' : 'bad');
    });
  };
})();
