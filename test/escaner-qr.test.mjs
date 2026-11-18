import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/entrega.html',import.meta.url),'utf8');
const leer=html.match(/function leerCuadro\(ahora\) \{[\s\S]*?\n  }/)[0];
const biblioteca=readFileSync(new URL('../public/jsQR.min.js',import.meta.url),'utf8');
const codigos=JSON.parse(readFileSync(new URL('fixtures/codigos-qr.json',import.meta.url),'utf8'));

// Lienzo mínimo para convertir la matriz QR estándar en cuadros de cámara.
// Se usa el decodificador real de producción, no una respuesta prefabricada.
function escenario(codigo,estado=2,{w=1280,h=720,x=w/2,y=h/2}={}){
 const matriz=codigo.matriz,modulo=6,tamano=matriz.length*modulo;
 const video={readyState:estado,videoWidth:w,videoHeight:h};
 const status={textContent:''};let muestra,fallar=false,lecturas=0,reloj=10000;
 const recibidos=[],pendientes=[];
 const pixel=(px,py)=>{
  const c=Math.floor((px-x+tamano/2)/modulo),f=Math.floor((py-y+tamano/2)/modulo);
  return f>=0&&c>=0&&f<matriz.length&&c<matriz.length&&matriz[f][c]==='1'?0:255;
 };
 const ctx={
  drawImage(_v,sx,sy,sw,sh,_dx,_dy,ancho,alto){
   const data=new Uint8ClampedArray(ancho*alto*4);
   for(let fy=0;fy<alto;fy++)for(let fx=0;fx<ancho;fx++){
    const i=(fy*ancho+fx)*4,n=pixel(sx+(fx+.5)*sw/ancho,sy+(fy+.5)*sh/alto);
    data[i]=data[i+1]=data[i+2]=n;data[i+3]=255;
   }
   muestra={data,width:ancho,height:alto};lecturas++;
  },
  getImageData(){if(fallar){fallar=false;throw Error('Cuadro transitorio');}return muestra;}
 };
 const lienzo={width:0,height:0,getContext:()=>ctx};
 const c=vm.createContext({escaneando:true,ultimoCodigo:'',ultimoTs:0,cuadroCamara:0,ultimoAnalisisCamara:-Infinity,intentoCamara:0,
  lienzo,$:id=>id==='video'?video:status,Date:{now:()=>reloj},navigator:{},
  entregar:(texto,origen)=>recibidos.push({texto,origen}),requestAnimationFrame:fn=>{pendientes.push(fn);return pendientes.length;}});
 vm.runInContext(biblioteca+'\n'+leer,c);
 return {c,video,status,lienzo,recibidos,pendientes,leer:t=>{reloj=t;vm.runInContext(`leerCuadro(${t})`,c);},
  fallar:()=>{fallar=true;},lecturas:()=>lecturas};
}

test('decodifica QR reales de pedido, cobertura y prueba con video en estados 2, 3 y 4',()=>{
 for(const codigo of codigos)for(const estado of [2,3,4]){
  const e=escenario(codigo,estado);e.leer(10000);
  assert.deepEqual(e.recibidos,[{texto:codigo.texto,origen:'camara'}]);
  assert.equal(e.pendientes.length,1);assert.ok(e.lienzo.width<=960&&e.lienzo.height<=960);
 }
});

test('un cuadro incompleto o una excepción transitoria no corta el ciclo de cámara',()=>{
 const e=escenario(codigos[0],1);e.leer(10000);assert.equal(e.recibidos.length,0);assert.equal(e.pendientes.length,1);
 e.video.readyState=2;e.video.videoWidth=0;e.leer(10200);assert.equal(e.recibidos.length,0);assert.equal(e.pendientes.length,2);
 e.video.videoWidth=1280;e.fallar();e.leer(10400);assert.match(e.status.textContent,/Reintentando/);assert.equal(e.pendientes.length,3);
 e.leer(10600);assert.equal(e.recibidos[0].texto,codigos[0].texto);assert.equal(e.pendientes.length,4);
});

test('alternar recorte y cuadro completo conserva QR fuera del centro, limita carga y no duplica lecturas',()=>{
 const e=escenario(codigos[0],2,{w:1920,h:1080,x:340,y:540});
 e.leer(10000);assert.equal(e.recibidos.length,1);
 const antes=e.lecturas();e.leer(10050);assert.equal(e.lecturas(),antes);
 e.leer(10200);assert.equal(e.recibidos.length,1);
 e.leer(13000);assert.equal(e.recibidos.length,2);
 e.c.escaneando=false;const pendientes=e.pendientes.length;e.leer(15000);assert.equal(e.pendientes.length,pendientes);
});

test('sin biblioteca avisa antes de pedir cámara y no registra comidas',async()=>{
 const fn=html.match(/async function alternarCamara\(prueba = false\) \{[\s\S]*?\n  }/)[0];let aviso;
 const c=vm.createContext({listaDeHoy:()=>true,SERVICIO_INICIADO:true,escaneando:false,ABRIENDO_CAMARA:false,
  $:()=>({textContent:''}),mostrarAviso:(...a)=>{aviso=a;}});
 vm.runInContext(fn,c);await c.alternarCamara();assert.match(aviso[1],/No se cargó el lector QR/);
});
