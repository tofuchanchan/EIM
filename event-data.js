window.EventData=(()=>{
  'use strict';
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
  function tracker(eventId){
    const visitId=token(),url='/api/public/'+encodeURIComponent(eventId)+'/visits';
    let visitorId=token();
    try{
      const key='invite-studio.visitor.v1',stored=localStorage.getItem(key);
      if(stored&&/^[a-f0-9]{32}$/.test(stored))visitorId=stored;else localStorage.setItem(key,visitorId);
    }catch{/* Restricted storage still allows this visit to be counted. */}
    let elapsed=0,since=null,timer=null,opened=false,atLast=false,reachedLast=false,ready=false;
    function payload(){
      return {visitId,visitorId,activeMs:Math.floor(elapsed+(since===null?0:performance.now()-since)),reachedLast};
    }
    function flush(leaving=false){
      if(!opened)return;
      const body=JSON.stringify(payload());
      if(leaving){
        try{if(navigator.sendBeacon?.(url,new Blob([body],{type:'application/json'})))return;}catch{/* Try keepalive below. */}
      }
      fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body,keepalive:true}).catch(()=>{});
    }
    function start(){
      if(!ready||document.visibilityState!=='visible'||since!==null)return;
      since=performance.now();opened=true;reachedLast||=atLast;flush();
      timer=setInterval(()=>flush(),10000);
    }
    function pause(){
      if(since===null)return;
      elapsed+=performance.now()-since;since=null;clearInterval(timer);timer=null;flush(true);
    }
    document.addEventListener('visibilitychange',()=>document.visibilityState==='visible'?start():pause());
    window.addEventListener('pagehide',pause);
    window.addEventListener('pageshow',start);
    return {payload,page(i,count){
      ready=true;atLast=i===count-1;
      start();
      if(atLast&&since!==null&&!reachedLast){reachedLast=true;flush();}
    }};
  }
  const count=n=>Number(n).toLocaleString('zh-CN');
  const pct=(n,d)=>d?(100*n/d).toFixed(1)+'%':'—';
  function duration(ms,visits){
    if(!visits)return '—';
    const s=Math.round(ms/visits/1000);
    return s<60?s+' 秒':Math.floor(s/60)+' 分 '+s%60+' 秒';
  }
  function render(report){
    const s=report.summary,trend=report.trend;
    const metrics=[
      ['浏览量（PV）',count(s.pv)],['独立访客（UV）',count(s.uv)],['平均浏览时长',duration(s.ms,s.pv)],
      ['抵达末页率',pct(s.reached,s.pv)],['成功报名',count(s.signups)],['访问报名转化率',pct(s.converted,s.pv)]
    ];
    const max=Math.max(1,...trend.flatMap(row=>[row.pv,row.signups]));
    return '<dl class="metrics-strip">'+metrics.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl>'+
      '<section class="metric-trend"><div class="metrics-head"><h2>近 '+trend.length+' 天趋势</h2><span><i></i>浏览量　<i></i>报名数</span></div>'+
      '<div class="metric-bars" aria-hidden="true">'+trend.map(r=>'<div title="'+r.day+' · 浏览 '+r.pv+' · 报名 '+r.signups+'"><i style="height:'+(r.pv/max*100)+'%"></i><b style="height:'+(r.signups/max*100)+'%"></b></div>').join('')+'</div>'+
      '<div class="metric-axis"><span>'+trend[0].day+'</span><span>'+trend.at(-1).day+'</span></div>'+
      '<details class="metric-info"><summary>统计口径与每日明细</summary><p>访问指标从功能启用后开始采集，历史报名数沿用已提交的记录。每次可见打开或刷新公开邀请函计一次浏览，访客按浏览器匿名标识去重。平均时长为前台可见总时长 ÷ 浏览量，约每 10 秒及离开时回传。末页率和转化率分别为抵达末页、成功报名的访问次数 ÷ 浏览量。访问指标按首次打开日归属，报名数按提交日归属，日期采用北京时间。</p>'+
      '<table class="s-table"><thead><tr><th>日期</th><th>浏览量</th><th>报名数</th></tr></thead><tbody>'+trend.slice().reverse().map(r=>'<tr><td>'+r.day+'</td><td>'+count(r.pv)+'</td><td>'+count(r.signups)+'</td></tr>').join('')+'</tbody></table></details></section>';
  }
  return {tracker,render,count,pct,duration};
})();
