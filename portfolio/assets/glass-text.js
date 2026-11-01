(() => {
  const words = document.querySelectorAll('.gw');
  if (!words.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const vertex = `attribute vec2 p; varying vec2 v; void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}`;
  const fragment = `precision mediump float;
    varying vec2 v; uniform sampler2D t; uniform float amt,time,ribs,shift,mx,mon,aspect;
    float h(float n){return fract(sin(n*91.73)*43758.5);}
    void main(){
      float x=v.x*ribs+shift,id=floor(x),f=fract(x),lens=f-.5;
      float near=exp(-pow((v.x-mx)*aspect*2.2,2.))*mon;
      float a=clamp(amt+near*.55,0.,1.4),r=h(id);
      vec2 uv=v;
      uv.x=(id+.5-shift)/ribs+lens*(1.-a*2.1)/ribs+sin(time*.7+id*.9)*.0025*a;
      uv.y=.5+(v.y-.5)*(1.-a*.55*r)+(r-.5)*a*.3+sin(time*1.3+id)*.006*a;
      float ca=(.0035+a*.014)*lens;
      vec4 cr=texture2D(t,uv+vec2(ca,0.)),cg=texture2D(t,uv),cb=texture2D(t,uv-vec2(ca,0.));
      float al=max(max(cr.a,cg.a),cb.a);vec3 col=vec3(cr.r,cg.g,cb.b);
      float rib=.78+.32*cos(lens*3.14159),spec=pow(max(0.,1.-abs(lens-.27)*6.5),3.);
      float edge=smoothstep(.44,.5,abs(lens));col*=mix(1.,rib,.35+min(a,1.)*.65);
      col+=vec3(1.,.93,.82)*spec*al*(.22+a*.35);
      float mask=smoothstep(0.,.05,v.x)*smoothstep(1.,.95,v.x)*smoothstep(0.,.1,v.y)*smoothstep(1.,.9,v.y);
      col*=mask;al*=mask;gl_FragColor=vec4(min(col,vec3(al)),al);
    }`;

  for (const word of words) {
    const spans = [...word.querySelectorAll(':scope > span')];
    if (!spans.length) continue;
    const canvas = document.createElement('canvas');
    canvas.className = 'glass-cv';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { zIndex: '2' });
    word.append(canvas);
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) { canvas.remove(); continue; }
    const compile = (kind, source) => {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    try {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      const uniforms = Object.fromEntries(['amt','time','ribs','shift','mx','mon','aspect'].map(k => [k, gl.getUniformLocation(program, k)]));
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      const source = document.createElement('canvas'), ctx = source.getContext('2d');
      let width = 1, height = 1, dpr = 1, mx = .5, pointer = 0, pointerEase = 0, start = performance.now(), amt = .1;
      function layout() {
        const rect = word.getBoundingClientRect();
        const boxes = spans.map(span => span.getBoundingClientRect());
        const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top));
        const right = Math.max(...boxes.map(box => box.right)), bottom = Math.max(...boxes.map(box => box.bottom));
        dpr = Math.min(devicePixelRatio || 1, 2);
        width = Math.max(1, right-left); height = Math.max(1, bottom-top);
        Object.assign(canvas.style, { left: `${left-rect.left}px`, top: `${top-rect.top}px`, width: `${width}px`, height: `${height}px` });
        canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
        source.width = canvas.width; source.height = canvas.height;
        spans.forEach(span => { span.style.visibility = 'hidden'; });
        ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
        spans.forEach(span => {
          const box = span.getBoundingClientRect(), style = getComputedStyle(span);
          ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          const x = box.left-left, y = box.top-top+box.height/2;
          if (span.dataset.fill === 'sunset') {
            const grad = ctx.createLinearGradient(0,y-box.height/2,0,y+box.height/2);
            grad.addColorStop(0,'#ffe2a0'); grad.addColorStop(.45,'#f2a545'); grad.addColorStop(1,'#e1281f'); ctx.fillStyle = grad;
          } else ctx.fillStyle = '#f5f5f4';
          ctx.fillText(span.textContent, x, y);
        });
        gl.viewport(0,0,canvas.width,canvas.height); gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      }
      function draw(now) {
        const rect = word.getBoundingClientRect(), center = (rect.top+rect.height/2)/innerHeight;
        const distance = Math.min(Math.abs(center-.5)*1.6, 1);
        const scrollAmt = distance*distance;
        amt += (scrollAmt - amt)*.12;
        pointerEase += (pointer-pointerEase)*.12;
        gl.uniform1f(uniforms.amt,amt); gl.uniform1f(uniforms.time,(now-start)/1000);
        gl.uniform1f(uniforms.ribs,Math.max(18,Math.round(width/22)));
        gl.uniform1f(uniforms.shift,(now-start)/1000*.19); gl.uniform1f(uniforms.mx,mx);
        gl.uniform1f(uniforms.mon,pointerEase); gl.uniform1f(uniforms.aspect,width/height);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        requestAnimationFrame(draw);
      }
      word.addEventListener('pointermove', e => { const r=word.getBoundingClientRect(); mx=(e.clientX-r.left)/r.width; pointer=1; });
      word.addEventListener('pointerleave', () => { pointer=0; });
      new ResizeObserver(layout).observe(word); document.fonts.ready.then(layout); layout(); requestAnimationFrame(draw);
      word.classList.add('glassed');
    } catch (error) { canvas.remove(); spans.forEach(span => span.style.visibility = ''); console.warn('Glass text effect unavailable', error); }
  }
})();
