/* Dongne Lens Quest — a cinematic, dependency-free projected 3D neighbourhood. */
(() => {
  'use strict';

  function initJourney() {
    const root = document.getElementById('journey-scene');
    if (!root) return;
    const make = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text) el.textContent = text;
      return el;
    };
    const DURATION = 24;
    const modes = [
      {id: 'cinematic', label: '시네마틱', accent: '#99f6d2', window: '#e5cdaa', quiet: false},
      {id: 'aurora', label: '오로라', accent: '#b8a5ff', window: '#d7ccff', quiet: false},
      {id: 'quiet', label: '고요한 밤', accent: '#9fc2e3', window: '#ffcf9b', quiet: true}
    ];
    let mode = modes[0];
    root.dataset.mode = mode.id;
    const header = make('div', 'journey-header');
    const caption = make('div', 'journey-caption');
    caption.append(make('span', 'journey-eyebrow', 'A JOURNEY TO YOUR NEXT HOME'));
    const destination = make('span', 'journey-destination', '마음에 둔 동네로');
    destination.id = 'journey-destination';
    caption.append(destination);
    const orbit = make('span', 'journey-orbit', '3D');
    orbit.setAttribute('aria-hidden', 'true');
    header.append(caption, orbit);

    const modeBar = make('div', 'journey-modes');
    modeBar.setAttribute('role', 'group');
    modeBar.setAttribute('aria-label', '3D 장면 분위기');
    const modeButtons = modes.map(item => {
      const button = make('button', 'journey-mode', item.label);
      button.type = 'button';
      button.id = `journey-mode-${item.id}`;
      button.dataset.mode = item.id;
      button.setAttribute('aria-pressed', String(item.id === mode.id));
      button.addEventListener('click', () => {
        mode = item;
        root.dataset.mode = item.id;
        modeButtons.forEach(el => el.setAttribute('aria-pressed', String(el.dataset.mode === item.id)));
        pointerYaw = 0;
        render();
      });
      modeBar.append(button);
      return button;
    });

    const canvas = make('canvas', 'journey-canvas');
    canvas.id = 'journey-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const description = make('p', 'sr-only', '불이 켜진 입체 아파트 마을을 작은 탐험가가 걸어갑니다. 카메라가 천천히 움직이는 24초 반복 장면이며 실제 지도가 아닌 상상의 마을입니다. 재생을 멈추거나 원하는 시점과 분위기를 선택할 수 있습니다.');
    description.id = 'journey-description';
    root.setAttribute('aria-describedby', 'journey-description');

    const footer = make('div', 'journey-footer');
    const timelineHeading = make('div', 'journey-timeline-heading');
    const chapter = make('span', 'journey-chapter', '01 · 새로운 동네로');
    chapter.id = 'journey-chapter';
    const timeLabel = make('span', 'journey-time', '00:00 / 00:24');
    timeLabel.setAttribute('aria-hidden', 'true');
    timelineHeading.append(chapter, timeLabel);
    const progress = make('input', 'journey-progress');
    progress.id = 'journey-progress';
    progress.type = 'range';
    progress.min = '0'; progress.max = String(DURATION); progress.step = '0.1'; progress.value = '0';
    progress.setAttribute('aria-label', '3D 장면 재생 위치');
    progress.setAttribute('aria-valuetext', '24초 중 0초');
    const controls = make('div', 'journey-controls');
    const toggle = make('button', 'journey-toggle');
    toggle.id = 'journey-toggle'; toggle.type = 'button';
    const restart = make('button', 'journey-restart', '↺');
    restart.id = 'journey-restart'; restart.type = 'button';
    restart.setAttribute('aria-label', '3D 장면 처음으로 되돌리기');
    restart.title = '처음부터';
    const realtime = make('span', 'journey-realtime', 'REALTIME 3D');
    realtime.setAttribute('aria-hidden', 'true');
    controls.append(toggle, restart, realtime);
    const mapNote = make('span', 'journey-map-note', '상상 속 마을 · 실제 지도 아님');
    footer.append(timelineHeading, progress, controls, mapNote);
    root.replaceChildren(header, modeBar, canvas, description, footer);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      canvas.hidden = true; modeBar.hidden = true; footer.hidden = true;
      description.className = 'journey-fallback';
      return;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let userPaused = motion.matches;
    let inView = true;
    let drawable = false;
    let width = 600, height = 330, baseScale = 1, scale = 1;
    let yaw = 0, cosYaw = 1, sinYaw = 0, pointerYaw = 0;
    let phase = 0, frame = null, lastTime = 0, paintTime = 0, uiTime = -1;
    let seeking = false;
    const palette = {
      ground: '#17262b', edge: '#10181f', edgeLight: '#24313c',
      mint: '#99f6d2', violet: '#b8a5ff', shadow: 'rgba(0,0,0,.28)'
    };
    const route = [
      [-143,65],[-133,86],[-103,96],[-75,87],[-60,66],[-57,42],
      [-44,23],[-19,17],[3,19],[24,17],[40,3],[43,-18]
    ];
    const route3d = route.map(([x,z]) => [x,2.5,z]);
    const buildings = [
      {x:-94,z:-50,w:55,d:49,h:110,front:'#567479',side:'#304851',top:'#82969a',floors:6,cols:3,seed:1},
      {x:0,z:-64,w:64,d:57,h:157,front:'#5b5e80',side:'#33394f',top:'#9290ad',floors:9,cols:3,seed:4},
      {x:99,z:19,w:52,d:47,h:88,front:'#476e67',side:'#294f4c',top:'#7c9b8c',floors:5,cols:3,seed:8}
    ];
    const trees = [[-145,-76,21],[-142,-9,26],[-98,32,23],[-37,-103,21],[68,-85,22],[128,-55,27],[139,64,21],[77,88,25],[18,87,20]];
    const stars = Array.from({length:38}, (_,i) => ({x:((i*73+19)%997)/997,y:((i*47+31)%491)/750,r:i%5===0?1.1:.65,phase:i*.91}));
    const scenery = buildings.map(b => ({x:b.x,z:b.z,draw:() => drawBuilding(b)}))
      .concat(trees.map(t => ({x:t[0],z:t[1],draw:() => drawTree(t)})));

    // Orthographic projection with a small, bounded world-space camera orbit.
    // Keeping the orbit under 15 degrees also preserves the visible face order.
    function project(x, y, z) {
      const rx = x*cosYaw-z*sinYaw, rz = x*sinYaw+z*cosYaw;
      return {x:width/2+(rx-rz)*.8*scale,y:height*.645+((rx+rz)*.4-y)*scale};
    }
    function depth(x,z) { return x*(cosYaw+sinYaw)+z*(cosYaw-sinYaw); }
    function polygon(points, fill, stroke, lineWidth = 1) {
      ctx.beginPath();
      points.forEach((p,i) => { const v=project(...p); if (!i) ctx.moveTo(v.x,v.y); else ctx.lineTo(v.x,v.y); });
      ctx.closePath();
      if (fill) { ctx.fillStyle=fill; ctx.fill(); }
      if (stroke) { ctx.lineWidth=lineWidth*scale; ctx.strokeStyle=stroke; ctx.stroke(); }
    }
    function line(points,color,lineWidth,dash=[]) {
      ctx.beginPath();
      points.forEach((p,i) => { const v=project(...p); if (!i) ctx.moveTo(v.x,v.y); else ctx.lineTo(v.x,v.y); });
      ctx.lineWidth=lineWidth*scale; ctx.strokeStyle=color; ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.setLineDash(dash.map(d=>d*scale)); ctx.stroke(); ctx.setLineDash([]);
    }
    function box(x,y,z,w,h,d,colors) {
      const l=x-w/2,r=x+w/2,b=z-d/2,f=z+d/2;
      polygon([[l,y,b],[l,y+h,b],[r,y+h,b],[r,y,b]],colors.side);
      polygon([[l,y,f],[l,y+h,f],[r,y+h,f],[r,y,f]],colors.front);
      polygon([[r,y,b],[r,y+h,b],[r,y+h,f],[r,y,f]],colors.side);
      polygon([[l,y+h,b],[r,y+h,b],[r,y+h,f],[l,y+h,f]],colors.top);
    }
    function groundCircle(x,z,radius,fill,y=1) {
      const points=[];
      for (let i=0;i<24;i++) {const a=i/24*Math.PI*2; points.push([x+Math.cos(a)*radius,y,z+Math.sin(a)*radius]);}
      polygon(points,fill);
    }
    function ellipseScreen(point,rx,ry,fill) {
      ctx.beginPath(); ctx.ellipse(point.x,point.y,rx*scale,ry*scale,0,0,Math.PI*2); ctx.fillStyle=fill;ctx.fill();
    }
    function drawBuilding(b) {
      const {x,z,w,d,h}=b;
      box(x,1,z,w+7,5,d+7,{front:'#354a50',side:'#1f3239',top:'#5b7073'});
      box(x,6,z,w,h,d,b);
      for (let row=0;row<b.floors;row++) {
        const yy=19+row*(h-23)/b.floors;
        for (let col=0;col<b.cols;col++) {
          const xx=x-w/2+8+col*(w-12)/b.cols;
          const light=(row*7+col*3+b.seed)%5!==0;
          const color=light ? ((row+col)%3===0?mode.accent:mode.window) : '#293e49';
          polygon([[xx,yy,z+d/2+.2],[xx,yy+8,z+d/2+.2],[xx+7,yy+8,z+d/2+.2],[xx+7,yy,z+d/2+.2]],color);
          if (light) line([[xx,yy,z+d/2+.3],[xx+7,yy,z+d/2+.3]],'rgba(255,247,219,.6)',.7);
          const zz=z-d/2+8+col*(d-12)/b.cols;
          polygon([[x+w/2+.2,yy,zz],[x+w/2+.2,yy+8,zz],[x+w/2+.2,yy+8,zz+6],[x+w/2+.2,yy,zz+6]],(row+col)%3===1?'#314852':color);
        }
      }
      box(x,h+6,z,w+3,4,d+3,b);
      box(x-9,h+10,z-4,22,9,20,b);
      const f=z+d/2+.4;
      polygon([[x-6,6,f],[x-6,20,f],[x+6,20,f],[x+6,6,f]],mode.window);
      polygon([[x-9,20,f+4],[x-9,24,f-1],[x+9,24,f-1],[x+9,20,f+4]],'#9fb6ad');
      line([[x-w/2,h+10,z+d/2],[x+w/2,h+10,z+d/2],[x+w/2,h+10,z-d/2]],'rgba(215,233,246,.65)',1);
      line([[x+w/2,7,z+d/2],[x+w/2,h+6,z+d/2]],'rgba(196,217,235,.3)',.8);
    }
    function drawTree(tree) {
      const [x,z,h]=tree;
      box(x,0,z,3,h*.65,3,{front:'#6f735e',side:'#414a40',top:'#92927a'});
      const colors=['#447b68','#284e47','#699d7f'];
      for (let i=0;i<3;i++) {
        const y=h*.38+i*h*.19,r=13-i*3;
        polygon([[x-r,y,z],[x,y+h*.48,z],[x,y,z+r]],colors[0]);
        polygon([[x,y,z+r],[x,y+h*.48,z],[x+r,y,z]],colors[1]);
        polygon([[x-r,y,z],[x,y+h*.48,z],[x,y,z-r]],colors[2]);
      }
    }
    function routePosition(t) {
      const segment=Math.max(0,Math.min(1,t))*(route.length-1);
      const index=Math.min(Math.floor(segment),route.length-2),f=segment-index;
      return {x:route[index][0]+(route[index+1][0]-route[index][0])*f,z:route[index][1]+(route[index+1][1]-route[index][1])*f};
    }
    function drawTraveller(person) {
      const {x,z}=person;
      ctx.save();
      // A gentle dissolve at the loop seam avoids a visible teleport.
      ctx.globalAlpha=userPaused?1:Math.min(1,phase/.7,(DURATION-phase)/.7);
      groundCircle(x+2,z+2,8,'rgba(0,0,0,.35)');
      const walking=phase<DURATION*.86;
      const step=walking?Math.sin(phase*(mode.quiet?3:5))*1.4:0;
      const dark={front:'#54667d',side:'#324254',top:'#7f91a6'};
      box(x-3,1,z+step,3,10,4,dark); box(x+3,1,z-step,3,10,4,dark);
      box(x,10,z,10,12,7,{front:'#f0e9d9',side:'#c6bda9',top:'#fff7e6'});
      box(x-3,11,z+5,7,10,5,{front:'#b8a5ff',side:'#7563b1',top:'#d4c9ff'});
      line([[x+7,19,z],[x+8,12,z+2]],'#e4bc9d',3);
      ellipseScreen(project(x,28,z),5.2,6.2,'#e8bb98');
      ellipseScreen(project(x,32,z),6.6,2.9,mode.accent);
      ellipseScreen(project(x,34,z),4.7,3,'#d2f9e8');
      ctx.restore();
    }
    function drawPin() {
      const bob=mode.quiet?0:Math.sin(phase*Math.PI/3)*2.5;
      const point=project(0,202+bob,-64);
      ellipseScreen(project(0,182,-64),16,5,'rgba(170,214,222,.11)');
      ctx.save();ctx.translate(point.x,point.y);ctx.scale(scale,scale);
      ctx.beginPath();ctx.moveTo(0,24);ctx.bezierCurveTo(-7,16,-16,6,-16,-4);ctx.arc(0,-4,16,Math.PI,0);ctx.bezierCurveTo(16,6,7,16,0,24);
      ctx.fillStyle=mode.accent;ctx.fill();
      ctx.strokeStyle='#13262c';ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(-8,-3);ctx.lineTo(0,-10);ctx.lineTo(8,-3);ctx.moveTo(-5,-5);ctx.lineTo(-5,5);ctx.lineTo(5,5);ctx.lineTo(5,-5);ctx.moveTo(0,5);ctx.lineTo(0,0);ctx.stroke();ctx.restore();
    }
    function drawAtmosphere() {
      stars.forEach(star => {
        const shimmer=mode.quiet?.65:.58+Math.sin(phase*.5+star.phase)*.2;
        ctx.fillStyle=`rgba(205,219,245,${shimmer})`;
        ctx.beginPath();ctx.arc(star.x*width,star.y*height,star.r,0,Math.PI*2);ctx.fill();
      });
      const center=project(0,-23,0);
      ctx.save();ctx.strokeStyle=mode.id==='aurora'?'rgba(184,165,255,.14)':'rgba(153,246,210,.12)';ctx.lineWidth=1;
      ctx.beginPath();ctx.ellipse(center.x,center.y,235*scale,95*scale,-.035,0,Math.PI*2);ctx.stroke();
      ctx.strokeStyle='rgba(160,185,217,.07)';ctx.beginPath();ctx.ellipse(center.x,center.y,251*scale,103*scale,-.035,0,Math.PI*2);ctx.stroke();
      ctx.restore();
    }
    function render() {
      if (!drawable || document.hidden || !isScreenVisible()) return;
      const cycle=phase/DURATION*Math.PI*2;
      const drift=mode.quiet?0:Math.sin(cycle)*.115+Math.sin(cycle*2)*.025;
      yaw=drift+(mode.quiet?0:pointerYaw);
      cosYaw=Math.cos(yaw);sinYaw=Math.sin(yaw);
      scale=baseScale*(mode.quiet?1:.97+Math.sin(cycle)*.025+Math.cos(cycle*2)*.012);
      ctx.clearRect(0,0,width,height);
      drawAtmosphere();
      ellipseScreen(project(0,-38,9),176,65,'rgba(0,0,0,.3)');
      box(0,-25,0,334,25,238,{front:palette.edgeLight,side:palette.edge,top:palette.ground});
      line([[-167,-18,119],[167,-18,119],[167,-18,-119]],'rgba(141,177,201,.23)',1);
      line([[-167,1,119],[167,1,119],[167,1,-119]],mode.accent,1.7);
      line(route3d,'#0a151c',23);
      line(route3d,mode.id==='aurora'?'rgba(184,165,255,.16)':'rgba(153,246,210,.14)',12);
      line(route3d,mode.accent,2.3);
      line(route3d,'rgba(238,249,255,.7)',.9,[2,9]);
      groundCircle(-143,65,11,'#1f3b3a');groundCircle(-143,65,4,mode.accent,3);
      groundCircle(43,-18,12,'#234340');groundCircle(43,-18,5,mode.accent,3);
      box(-109,1,3,37,3,18,{front:'#243f3d',side:'#19312f',top:'#39594c'});
      box(87,1,72,49,3,14,{front:'#29413b',side:'#19312f',top:'#3f5d4c'});
      trees.forEach(([x,z])=>groundCircle(x+3,z+4,12,palette.shadow));
      buildings.forEach(b=>polygon([[b.x-b.w/2,1,b.z+b.d/2],[b.x+b.w/2+24,1,b.z+b.d/2+28],[b.x+b.w/2+24,1,b.z-b.d/2+28],[b.x+b.w/2,1,b.z-b.d/2]],palette.shadow));
      const person=routePosition(phase/(DURATION*.86));
      const objects=scenery.map(object=>({depth:depth(object.x,object.z),draw:object.draw}));
      objects.push({depth:depth(person.x,person.z),draw:()=>drawTraveller(person)});
      objects.sort((a,b)=>a.depth-b.depth).forEach(object=>object.draw());
      drawPin();
      updateTimeline();
    }
    function updateTimeline(force=false) {
      const tenths=Math.floor(phase*10);
      // Only refresh the small DOM readout four times a second, never as a live region.
      if (!force && Math.abs(tenths-uiTime)<3) return;
      uiTime=tenths;
      if (!seeking) progress.value=phase.toFixed(1);
      const spokenTime=phase.toFixed(1).replace(/\.0$/,'');
      progress.setAttribute('aria-valuetext',`24초 중 ${spokenTime}초`);
      timeLabel.textContent=`00:${String(Math.floor(phase)).padStart(2,'0')} / 00:24`;
      chapter.textContent=phase<8?'01 · 새로운 동네로':phase<16?'02 · 나의 속도로 둘러보기':'03 · 마음이 머무는 집';
    }
    function updateToggle() {
      toggle.textContent=userPaused?'▶ 재생':'Ⅱ 일시정지';
      toggle.setAttribute('aria-pressed',String(!userPaused));
      toggle.setAttribute('aria-label',userPaused?'3D 장면 재생':'3D 장면 일시정지');
      root.dataset.playing=String(!userPaused);
    }
    function isScreenVisible() {
      // The same scene moves between the welcome and home screens. A route can
      // hide its parent before IntersectionObserver delivers its next entry.
      return root.isConnected && !root.closest('[hidden], [inert]');
    }
    function canAnimate() {return drawable&&!userPaused&&!seeking&&inView&&!document.hidden&&isScreenVisible();}
    function animate(time) {
      frame=null;
      if (!canAnimate()) {lastTime=0;return;}
      if (!lastTime) lastTime=time;
      const delta=Math.min((time-lastTime)/1000,.08);lastTime=time;
      phase=(phase+delta)%DURATION;
      if (time-paintTime>=1000/30) {render();paintTime=time;}
      frame=requestAnimationFrame(animate);
    }
    function syncAnimation() {
      if (frame!==null) cancelAnimationFrame(frame);
      frame=null;lastTime=0;
      if (canAnimate()) frame=requestAnimationFrame(animate);
      else if (drawable && isScreenVisible() && !document.hidden) render();
    }
    function resize() {
      const rect=canvas.getBoundingClientRect();
      // Keep the last good bitmap while the router briefly hides/reparents us.
      // A 1px backing store would otherwise flash or leave a tiny blank scene.
      drawable=Number.isFinite(rect.width)&&Number.isFinite(rect.height)&&rect.width>0&&rect.height>0&&isScreenVisible();
      if (!drawable) {syncAnimation();return;}
      width=rect.width;height=rect.height;
      const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,1.75));
      const pixelWidth=Math.max(1,Math.round(width*dpr));
      const pixelHeight=Math.max(1,Math.round(height*dpr));
      if (canvas.width!==pixelWidth) canvas.width=pixelWidth;
      if (canvas.height!==pixelHeight) canvas.height=pixelHeight;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      baseScale=Math.min(width/550,height/400,1.25);
      render();
      syncAnimation();
    }
    toggle.addEventListener('click',()=>{userPaused=!userPaused;updateToggle();syncAnimation();});
    restart.addEventListener('click',()=>{phase=0;updateTimeline(true);render();});
    progress.addEventListener('pointerdown',()=>{seeking=true;syncAnimation();});
    progress.addEventListener('input',()=>{
      phase=Math.max(0,Math.min(DURATION,Number(progress.value)||0));
      updateTimeline(true);render();
    });
    const finishSeeking=()=>{if (seeking) {seeking=false;syncAnimation();}};
    progress.addEventListener('change',finishSeeking);
    window.addEventListener('pointerup',finishSeeking);
    window.addEventListener('pointercancel',finishSeeking);
    progress.addEventListener('blur',finishSeeking);
    root.addEventListener('pointermove',event=>{
      if (!drawable||userPaused||motion.matches||mode.quiet||event.pointerType==='touch'||!isScreenVisible()) return;
      const rect=root.getBoundingClientRect();
      if (!rect.width) return;
      pointerYaw=((event.clientX-rect.left)/rect.width-.5)*.05;
    });
    root.addEventListener('pointerleave',()=>{pointerYaw=0;});
    document.addEventListener('visibilitychange',()=>{
      if (document.hidden) syncAnimation(); else resize();
    });
    window.addEventListener('lens:screen-change',()=>{
      pointerYaw=0;
      // Visibility is computed now instead of waiting for a stale observer
      // entry from the previous parent. The observer still handles scrolling.
      const rect=root.getBoundingClientRect();
      inView=isScreenVisible()&&rect.bottom>0&&rect.top<window.innerHeight;
      resize();
    });
    motion.addEventListener('change',()=>{
      if (motion.matches) {userPaused=true;pointerYaw=0;}
      updateToggle();syncAnimation();
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries=>{
        const entry=entries.find(item=>item.target===root)||entries[0];
        inView=Boolean(entry?.isIntersecting);
        if (inView && isScreenVisible()) resize(); else syncAnimation();
      },{threshold:.05}).observe(root);
    }
    if ('ResizeObserver' in window) {
      const observer=new ResizeObserver(resize);
      observer.observe(root);observer.observe(canvas);
    }
    else window.addEventListener('resize',resize);
    window.addEventListener('lens:destination',event=>{
      const name=typeof event.detail?.name==='string'?event.detail.name:'마음에 둔 동네로';
      destination.textContent=name;destination.title=name;phase=0;updateTimeline(true);render();
    });
    updateToggle();resize();
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',initJourney,{once:true});
  else initJourney();
})();
