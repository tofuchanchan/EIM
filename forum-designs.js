/* One Zhongbang event brief, six art directions. Every item returned here is an ordinary,
   editable canvas component. The photos, logo lockups and map are image assets. */
window.ForumTemplates = (() => {
  'use strict';
  const example = {
    title:'中邦财智伙伴会', date:'2027-03-19', time:'14:00',
    place:'深圳南山区 · 金融科技大厦 A 座',
    host:'中邦', slogan:'共研业财，共拓机遇', subtitle:'业财数智化案例分享与产融对接',
    signature:'中邦 · 会务组'
  };
  const looks = {
    archive:{name:'建筑年鉴',description:'暖白纸色、铜色细线与建筑摄影',paper:'#f6f3ec',ink:'#172e39',muted:'#495a60',accent:'#885633',tint:'#e9e4d9',mark:'darkMark',font:'serif'},
    blueprint:{name:'蓝图坐标',description:'深夜蓝、青色线稿与网格排版',paper:'#0a1c2b',ink:'#effaf8',muted:'#b8cdcf',accent:'#86e7d6',tint:'#153142',mark:'lightMark',font:'sans'},
    salon:{name:'会客手札',description:'酒红油墨、宋体与纸张静物',paper:'#fbf4eb',ink:'#472b30',muted:'#685457',accent:'#782e42',tint:'#f0e1d8',mark:'wineMark',font:'serif'},
    poster:{name:'启势海报',description:'橙黑撞色、斜切图形与大字海报',paper:'#ff824e',ink:'#1c1b18',muted:'#402d23',accent:'#37231c',tint:'#ffd9a9',mark:'blackMark',font:'sans'},
    ink:{name:'水墨山岚',description:'水墨长卷、青黛宋体与宣纸留白',paper:'#f3f3e8',ink:'#253f35',muted:'#475b50',accent:'#536953',tint:'#e0e7d9',mark:'jadeMark',font:'serif'},
    neural:{name:'神经光谱',description:'近黑底、紫色粒子网络与光谱对比',paper:'#100d1d',ink:'#faf5ff',muted:'#d1c7df',accent:'#c9a3ff',tint:'#29223b',mark:'lightMark',font:'sans'}
  };
  const agenda = [
    ['时段','活动安排'],
    ['13:30–14:00','嘉宾签到 · 领取会议资料'],
    ['14:00–14:15','开场致辞｜伙伴合作议题'],
    ['14:15–14:55','中邦分享｜财云应用案例'],
    ['14:55–15:10','茶歇交流｜征集业务问题'],
    ['15:10–15:55','项目路演｜业务与资金需求'],
    ['15:55–16:30','商务洽谈｜伙伴对接']
  ];
  const letter = [
    '尊敬的企业伙伴：',
    '同一笔业务，从签约到回款，经营团队和财务团队看到的往往是两套信息。怎样把订单、成本与资金放在同一张经营图上？',
    '中邦诚邀您出席「{{title}}」。我们将以财云应用案例为起点，拆解业财数据如何进入经营决策，再用项目路演交流企业真实的合作需求。',
    '欢迎带来一个业务场景或一份项目简介，在会后的洽谈环节，与合适的伙伴继续交流。'
  ];
  const guide = [
    ['签到入场','请于 13:30 起到金融科技大厦接待处，凭回执中的姓名和单位签到、领取议程。'],
    ['会前准备','建议准备一页项目简介，写清业务场景、当前进展，以及最希望对接的资金或产业资源。'],
    ['现场交流','路演与讨论面向受邀来宾。案例中请隐去客户敏感信息，引用或拍摄发言前与分享者确认。']
  ];
  const about = [
    '中邦（深圳）数字信息服务有限公司面向企业提供业财数智化解决方案，服务涉及财税咨询、财务共享、内部控制和业财融合。',
    '在这次交流中，财云案例分享与项目路演相互衔接。业务、财务与产业伙伴可以当面讨论需求，并在洽谈环节约定下一步合作。',
    '期待与您相见。'
  ];

  function make(key='archive') {
    if(!Object.hasOwn(looks,key))throw new Error('未找到邀请函样式。');
    const t=looks[key], media=window.ForumMedia, layout=window.InviteLayout;
    const tech=key==='blueprint', salon=key==='salon',poster=key==='poster',ink=key==='ink',ai=key==='neural';
    const margin=salon||ink?10:poster?6:7.5, width=100-2*margin, pages=[];
    const align=salon||ai?'center':'left';
    function page(name) {
      const p=layout.makePage(name);
      p.id='forumP'+(pages.length+1);p.background=t.paper;p.transition=tech||poster?'slide':ai?'zoom':'fade';
      pages.push(p);return p;
    }
    function put(p,role,type,box,content,s={},effect='none') {
      const [x,y,w,h]=box;
      const style={color:t.ink,background:'transparent',font:'sans',fontSize:16,align:'left',bold:false,radius:0,...s};
      const el=layout.makeElement(type,{id:p.id+'_'+role,x,y,w,h,content,style,
        animation:{type:effect,duration:tech?300:440,delay:0}});
      p.elements.push(el);return el;
    }
    function words(p,role,value,box,size,style={}) {
      return put(p,role,'paragraph',box,{text:value},{fontSize:size,...style});
    }
    function title(p,role,value,box,size,style={}) {
      return put(p,role,'title',box,{text:value},{font:t.font,fontSize:size,bold:true,align,...style},'rise');
    }
    function rule(p,role,x,y,w,color=t.accent) {
      return put(p,role,'divider',[x,y,w,0.8],{},{color});
    }
    function image(p,role,src,alt,box,fit='cover') {
      return put(p,role,'image',box,{src,alt,fit},{},'fade');
    }
    function logo(p,box) {return image(p,'logo',media[t.mark],'中邦 · ZONEBOND',box,'contain');}
    function head(p,name) {
      if(poster){
        if(name==='会场导航'){
          logo(p,[6,3.5,29,5]);rule(p,'mastRule',6,10,88);
          title(p,'heading',name,[6,54,88,9],36);return;
        }
        logo(p,[6,4,27,4.5]);rule(p,'mastRule',6,11,88);
        title(p,'heading',name,[6,15,88,10],39);return;
      }
      if(ink){
        image(p,'paperArt','@cover','',[46,0,54,12]);logo(p,[10,4.2,28,4.2]);rule(p,'mastRule',10,10.8,22);
        if(['诚挚邀请','活动议程','参会须知','会场导航'].includes(name)){
          title(p,'heading',name,[6.5,18,11.5,46],29,{align:'center',bold:false});return;
        }
        title(p,'heading',name,[10,15,80,10],34,{bold:false});return;
      }
      if(ai){
        image(p,'spectrum','@cover','',[0,0,100,11]);logo(p,[5.5,3.2,27,4.5]);rule(p,'mastRule',34,12.2,32);
        title(p,'heading',name,[6,16,88,9],34);return;
      }
      logo(p,salon?[34,4.2,32,4.7]:tech?[62,4.2,30,4.5]:[margin,4.2,34,4.7]);
      if(tech)rule(p,'mastRule',margin,7,40);
      else rule(p,'mastRule',salon?43:margin,11.5,salon?14:width);
      title(p,'heading',name,[margin,tech?13:16,width,9],salon?32:35);
    }
    function note(p,role,value,box) {
      return put(p,role,'textbox',box,{text:value},{background:t.tint,color:t.ink,fontSize:14,align});
    }
    const p1=page('邀请函首页');
    const covers={
      archive:{picture:[0,41,100,32],logo:[7.5,5,43,6.3],slogan:[55,6.3,37,5],tag:[7.5,17,85,5],title:[7.5,23,86,10],sub:[7.5,33.6,85,6.3],rule:[7.5,13.5,85],foot:78},
      blueprint:{picture:[0,12,100,39],logo:[7.5,4,42,6.2],slogan:[55,5,37,5],tag:[7.5,52.4,85,5],title:[7.5,58.1,86,10],sub:[7.5,69.3,85,6],rule:[7.5,78,85],foot:82},
      salon:{picture:[10,17,80,29],logo:[32,4,36,6.1],slogan:[10,10.8,80,4.3],tag:[10,49.2,80,4.8],title:[6,56,88,10],sub:[7,67.3,86,6.5],rule:[42,78,16],foot:82}
    };
    Object.assign(covers,{
      poster:{picture:[52,0,48,70],logo:[6,5,43,6.5],slogan:[7,14,39,5],tag:[6,25,44,5],title:[6,33,46,22],sub:[6,56,44,13],rule:[6,74,88],foot:80},
      ink:{picture:[0,0,100,44],logo:[9,46,32,5],slogan:[55,47,35,5],tag:[10,54,80,4.5],title:[10,60,82,10],sub:[10,71,81,6.2],rule:[10,79,81],foot:84},
      neural:{picture:[0,19,100,37],logo:[33,4,34,5.5],slogan:[8,12,84,5],tag:[8,55,84,4.5],title:[5,61,90,10],sub:[6,72,88,6],rule:[7.5,81,85],foot:85}
    });
    const pos=covers[key];
    image(p1,'hero','@cover','论坛主视觉',pos.picture);
    logo(p1,pos.logo);
    words(p1,'slogan',example.slogan,pos.slogan,13,{color:t.accent,align:salon||ai?'center':poster?'left':'right',bold:!salon&&!ink});
    words(p1,'edition','商务邀请函',pos.tag,14,{color:t.accent,align,bold:true});
    title(p1,'title','{{title}}',pos.title,poster?38:salon?34:36);
    words(p1,'subtitle',example.subtitle,pos.sub,15,{color:t.muted,align});
    rule(p1,'hairline',...pos.rule);
    const foot=pos.foot;
    words(p1,'dateLabel','活动时间',[margin,foot,49,4.5],12,{color:t.muted});
    words(p1,'date','{{date}}  {{time}}',[margin,foot+5.5,54,7],17,{bold:tech});
    words(p1,'hostLabel','承办单位',[65,foot,28,4.5],12,{color:t.muted,align:'right'});
    words(p1,'host',example.host,[64,foot+5.5,29,7],17,{align:'right'});

    const p2=page('诚挚邀请');head(p2,p2.name);
    if(salon){
      words(p2,'salutation',letter[0],[10,29,80,5.5],16,{font:'serif',bold:true});
      put(p2,'letterbody','textbox',[7,36,86,43],{text:letter.slice(1,3).join('\n\n')},{background:'#f4e8df',font:'serif',fontSize:15});
      words(p2,'request',letter[3],[10,81,80,10.8],14,{font:'serif'});
      words(p2,'signature',example.signature,[10,93,80,5],13,{align:'right'});
    }else if(ink){
      words(p2,'salutation',letter[0],[24,19,68,7],16,{bold:true,font:'serif'});
      words(p2,'opening',letter[1],[24,29,68,23],15,{font:'serif'});
      words(p2,'invitation',letter[2],[24,52,68,23],15,{font:'serif'});
      words(p2,'request',letter[3],[24,76,68,14],14,{font:'serif',color:t.muted});
      words(p2,'signature',example.signature,[22,93,70,5],13,{align:'right'});
    }else{
      words(p2,'salutation',letter[0],[margin,27,width,6.5],17,{bold:true});
      const textX=tech?19:margin,textW=tech?73:width;
      if(tech||ai){
        put(p2,'opening','textbox',[margin,35,width,20],{text:letter[1]},{background:t.tint,color:t.ink,fontSize:15});
      }else words(p2,'opening',letter[1],[textX,35,textW,20],poster?18:16,{bold:poster});
      words(p2,'invitation',letter[2],[textX,57,textW,19],15.5);
      words(p2,'request',letter[3],[textX,77,textW,12],15,{color:t.muted});
      rule(p2,'signatureRule',margin,89,tech?12:24);
      words(p2,'signature',example.signature,[margin,92,width,5],14,{align:ai?'right':'left',bold:true});
    }

    const p3=page('活动议程');head(p3,p3.name);
    const scheduleCaption='{{date}}   /   13:30 签到，16:30 结束';
    const takeaway='请准备一页项目简介，用于路演与会后的伙伴对接。';
    words(p3,'when',scheduleCaption,ink?[23,18,70,10]:[margin,27,width,8],ink?14:15,{color:t.accent,align});
    if(ink){
      words(p3,'columnTime',agenda[0][0],[23,29,24,4.5],12,{color:t.muted});
      words(p3,'columnTopic',agenda[0][1],[48,29,45,4.5],12,{color:t.muted});
      agenda.slice(1).forEach(([clock,topic],i)=>{
        const x=23+(i%2)*36,y=35+Math.floor(i/2)*16.5;
        rule(p3,'slip'+i,x,y,32,'#94a594');
        words(p3,'time'+i,clock,[x,y+1.5,33,4.4],13,{font:'serif',color:t.accent});
        words(p3,'slot'+i,topic,[x,y+6,33,9.7],14,{font:'serif'});
      });
    }else if(salon||poster||ai){
      const left=poster?6:9,split=poster?37:38;
      words(p3,'columnTime',agenda[0][0],[left,35,27,4],12,{color:t.muted,bold:true});
      words(p3,'columnTopic',agenda[0][1],[split,35,55,4],12,{color:t.muted,bold:true});
      if(ai)put(p3,'axis','textbox',[34.5,42,.5,37],{text:''},{background:'#795aa3'});
      agenda.slice(1).forEach(([clock,topic],i)=>{
        const y=41+i*7.35;
        if(salon){
          words(p3,'time'+i,clock,[left,y,30,6],13,{font:'serif',color:t.accent});
          words(p3,'slot'+i,topic,[split,y,54,6.3],14,{font:'serif'});
          rule(p3,'rule'+i,left,y+5.9,82,'#dbc9c1');
        }else{
          if(ai){
            put(p3,'node'+i,'textbox',[33.55,y+1.9,2.4,1.3],{text:''},{background:t.accent,radius:8});
            words(p3,'time'+i,clock,[left,y,23,5.6],13,{align:'right',color:t.accent,bold:true});
          }else put(p3,'time'+i,'textbox',[left,y-.4,27,6.5],{text:clock},
            {fontSize:13,bold:true,align:'center',color:'#fff7e4',background:t.ink});
          words(p3,'slot'+i,topic,[split,y,55,6.3],14,{bold:poster});
        }
      });
    }else if(tech){
      // Two independent rails: operators can move or style times separately from topics.
      put(p3,'timeRail','table',[7.5,35.5,33,47.5],{rows:agenda.map(r=>[r[0]]),lines:'grid'},
        {fontSize:14,color:t.accent,background:t.tint});
      put(p3,'topicRail','table',[42,35.5,50.5,47.5],{rows:agenda.map(r=>[r[1]]),lines:'grid'},
        {fontSize:14,color:t.ink});
    }else{
      put(p3,'agenda','table',[margin,35.5,width,47.5],{rows:agenda.map(row=>row.slice()),lines:tech?'grid':'ruled'}, {fontSize:14,color:t.ink});
    }
    rule(p3,'closeRule',margin,86,width);
    note(p3,'takeaway',takeaway,[margin,88,width,10]);

    const p4=page('会场导航');head(p4,p4.name);
    const venues={
      archive:{map:[7.5,26,85,34],credit:[7.5,60.5,85,4.4],address:[7.5,67,85,10],travel:[7.5,77.8,85,8],cta:[7.5,88,85,7.5]},
      blueprint:{map:[0,42,100,35],credit:[7.5,77.5,85,4.4],address:[7.5,25,85,8.5],travel:[7.5,34,85,7.5],cta:[7.5,87,85,8]},
      salon:{map:[10,39,80,32],credit:[10,71,80,4.4],address:[9,26,82,12],travel:[10,78,80,8],cta:[18,89,64,7.5]},
      poster:{map:[0,12,100,35],credit:[6,47.7,88,4.4],address:[6,66,41,17],travel:[52,66,42,17],cta:[0,89,100,11]},
      ink:{map:[22,17,73,35],credit:[22,52,73,4.4],address:[24,62,67,11],travel:[24,75,67,10],cta:[24,89,67,7.8]},
      neural:{map:[6,39,88,35],credit:[6,74,88,4.4],address:[8,26,84,11],travel:[7,81,86,7.4],cta:[21,90,58,7.7]}
    };
    const venue=venues[key];
    image(p4,'venueMap',media.map,'深圳金融科技大厦 A 座与高新中站位置图',venue.map,'contain');
    put(p4,'mapCredit','button',venue.credit,{text:'© OpenStreetMap contributors · OpenMapTiles',action:'link',url:'https://www.openstreetmap.org/copyright'},
      {color:t.muted,fontSize:11,align:'right'});
    if(salon)note(p4,'address','{{place}}',venue.address);
    else words(p4,'address','{{place}}',venue.address,18,{font:t.font,bold:true,align});
    words(p4,'metro','轨道交通 13 号线高新中站，步行前往金融科技大厦 A 座。',venue.travel,14,{color:t.muted,align});
    put(p4,'navigate','button',venue.cta,{text:'打开地图导航',action:'link',url:'https://www.amap.com/place/B0FFG9LEY2'},{color:tech||ai?t.paper:'#ffffff',background:tech||ai?t.accent:t.ink,bold:true,align:'center',radius:ai?30:0});

    const p5=page('受邀回执');head(p5,p5.name);
    words(p5,'intro','请留下参会信息，方便筹备组为您安排现场接待。',[margin,27,width,10],16,{color:t.muted,align});
    put(p5,'response','button',[margin,38,width,59.5],{text:'提交回执',action:'inline-register',url:''},
      {color:poster?'#ffe8d9':tech?t.accent:ai?'#462363':t.ink,background:poster?t.ink:ai?'#ece4fa':salon?t.tint:'transparent',fontSize:15,align:'left',radius:ai?14:0});

    const p6=page('参会须知');head(p6,p6.name);
    guide.forEach(([name,body],i)=>{
      const y=ink?18+i*26:29+i*22,x=ink?24:margin,w=ink?68:width;
      rule(p6,'line'+i,x,y,w);
      title(p6,'topic'+i,name,[x,y+2.8,tech?25:w,6.4],tech?19:20,{align:salon?'center':'left'});
      if(ai)put(p6,'body'+i,'textbox',[x,y+9,w,13],{text:body},{background:t.tint,color:t.ink,fontSize:14});
      else words(p6,'body'+i,body,tech?[35,y+2.8,57.5,17.5]:[x,y+9.2,w,ink?15:12],15,{color:t.muted,font:ink?'serif':'sans'});
    });

    const p7=page('关于承办方');
    const photo=poster?[0,0,100,32]:ink?[0,0,100,30]:ai?[0,0,100,33]:tech?[0,0,100,33]:salon?[0,0,29,100]:[0,0,100,28];
    image(p7,'closingHero','@cover','论坛主视觉',photo);
    logo(p7,salon?[39,9,48,7]:[margin,35.5,40,6]);
    title(p7,'heading',p7.name,salon?[35,22,59,10]:[margin,45,width,9],poster?37:32);
    words(p7,'company',about[0],salon?[36,37,56,23]:[margin,57,width,15],salon?15:16);
    words(p7,'role',about[1],salon?[36,62,56,21]:[margin,73,width,13],15,{color:t.muted});
    rule(p7,'endRule',salon?54:margin,88,salon?16:24);
    words(p7,'close',about[2],salon?[35,92,59,5]:[margin,92,width,5],16,{font:t.font,bold:true,align});
    return {pages};
  }

  function sample(key='archive') {
    return {id:'sample_'+key,template:'invitation',version:0,status:'draft',title:example.title,
      date:example.date,time:example.time,place:example.place,detail:'',blocks:[],theme:'teal',
      cover:window.ForumMedia[key],design:make(key),fields:[
        {key:'company',label:'企业名称',required:true},{key:'name',label:'联系人',required:true},{key:'phone',label:'手机号码',required:true}
      ]};
  }
  return Object.freeze({looks,example,sample});
})();
