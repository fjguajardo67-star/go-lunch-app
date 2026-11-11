import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import QRCode from 'qrcode';
import { mananaMexico, ventanaDiaria, htmlSinScripts, puedeEnviar, argumentosImpresora } from './logica.mjs';

// La contraseña llega por stdin desde DPAPI, nunca por argumentos ni archivos de texto.
let entrada=''; for await (const chunk of process.stdin) entrada+=chunk;
const { config, clave, modo, fecha: fechaManual, reimprimir=false } = JSON.parse(entrada);
entrada='';
const base = config.base.replace(/\/$/,'');
if (new URL(base).protocol !== 'https:') throw new Error('Se requiere HTTPS');
const headers = {'x-admin-key':clave, 'x-panel-user':'gerente'};
const salida = config.carpeta;
await mkdir(salida,{recursive:true});
const log = async texto => {
  const linea=`${new Date().toISOString()} ${texto}\n`;
  await writeFile(path.join(salida,'impresion.log'),linea,{flag:'a'});
  console.log(texto);
};
const get = async (ruta, json=true) => {
  const r=await fetch(base+ruta,{headers,signal:AbortSignal.timeout(45000),redirect:'error'});
  if(!r.ok) throw new Error(`El servicio respondió ${r.status}. Revise conexión y clave.`);
  return json?r.json():r.text();
};
const guardarEstado = async (archivo, estado) => {
  const tmp=archivo+'.tmp';
  await writeFile(tmp,JSON.stringify(estado,null,2));
  await rename(tmp,archivo);
};
const sumatra = args => new Promise((resolve,reject)=>{
  const p=spawn(config.sumatra,args,{windowsHide:true,stdio:'ignore',shell:false});
  const limite=setTimeout(()=>{ p.kill();reject(new Error('Sumatra no confirmó el envío en 120 segundos; revise la cola de Windows.')); },120000);
  p.on('error',e=>{clearTimeout(limite);reject(e);});
  p.on('exit',code=>{clearTimeout(limite);code===0?resolve():reject(new Error(`Sumatra terminó con código ${code}. Revise la impresora.`));});
});

let browser, bloqueo;
const archivoBloqueo=path.join(salida,'impresion.lock');
try {
  try { bloqueo=await open(archivoBloqueo,'wx'); }
  catch(e) {
    if(e.code==='EEXIST') throw new Error('Ya hay una impresion en curso o quedo un bloqueo de un cierre inesperado. Revise la cola y el proceso antes de quitar impresion.lock.');
    throw e;
  }
  await bloqueo.writeFile(String(process.pid));
  if(modo==='diario' && !ventanaDiaria()) {await log('Fuera de la ventana 21:30–23:59; no se imprime.'); process.exitCode=0;}
  else {
    const fecha = fechaManual || mananaMexico();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha inválida');
    const dia=path.join(salida,fecha); await mkdir(dia,{recursive:true});
    const archivoEstado=path.join(dia,'estado.json');
    let estado=existsSync(archivoEstado)?JSON.parse(await readFile(archivoEstado,'utf8')):{};
    if(reimprimir) { // Solo el operador, después de revisar impresora y cola.
      await writeFile(path.join(dia,`estado-anterior-${Date.now()}.json`),JSON.stringify(estado));
      estado={};
    }
    const [pedidos,resumen]=await Promise.all([get(`/api/comidas/${fecha}`),get(`/api/resumen-cocina/${fecha}`)]);
    if(!Array.isArray(pedidos.comidas) || !Array.isArray(resumen.resumen) || pedidos.count!==resumen.total) {
      throw new Error('El conteo cambió entre consultas. No se imprime; vuelva a preparar.');
    }
    if(!pedidos.count) {
      if(modo==='preparar') throw new Error('La fecha elegida no tiene pedidos. Repita la prueba con una fecha que si tenga pedidos.');
      await log(`${fecha}: sin pedidos, no se imprime.`);
    }
    else {
      if(!existsSync(config.edge)||!existsSync(config.sumatra)) throw new Error('Falta Edge o SumatraPDF. Ejecute Instalar.cmd.');
      const credencial=encodeURIComponent(clave);
      // Descargar por HTTPS en Node; el navegador solo recibe HTML, sin la clave.
      const [comanda, etiquetas]=await Promise.all([
        get(`/comanda/${fecha}?key=${credencial}&ancho=58`,false),
        get(`/etiquetas/${fecha}?key=${credencial}&ancho=200&alto=62`,false)
      ]);
      if(!comanda.includes('COMANDA DE COCINA')||!etiquetas.includes('class="etiqueta"')) throw new Error('La vista imprimible no es válida.');
      browser=await chromium.launch({executablePath:config.edge,headless:true});
      const page=await browser.newPage({viewport:{width:235,height:900}});
      // Ninguna dependencia remota: QR generado localmente y recursos externos bloqueados.
      await page.route('**/*',route=>route.abort());
      await page.setContent(htmlSinScripts(comanda),{waitUntil:'load'});
      await page.emulateMedia({media:'print'});
      await page.addStyleTag({content:'@page { size: auto; margin: 0; }'});
      const alto=await page.evaluate(()=>Math.ceil(document.body.getBoundingClientRect().height*25.4/96)+4);
      const preparacion=path.join(dia,`preparacion-${Date.now()}`); await mkdir(preparacion,{recursive:true});
      const archivoComanda=path.join(preparacion,'comanda.pdf');
      await page.pdf({path:archivoComanda,width:'58mm',height:`${Math.max(80,alto)}mm`,margin:{top:'0mm',bottom:'0mm',left:'0mm',right:'0mm'},preferCSSPageSize:false,displayHeaderFooter:false});
      await page.setContent(htmlSinScripts(etiquetas),{waitUntil:'load'});
      const codigos=await page.locator('.qr[data-codigo]').evaluateAll(els=>els.map(e=>e.dataset.codigo));
      if(codigos.length!==pedidos.count) throw new Error('El número de etiquetas no coincide con los pedidos.');
      const imagenes=await Promise.all(codigos.map(c=>QRCode.toDataURL(c,{width:240,margin:2,errorCorrectionLevel:'M'})));
      await page.locator('.qr[data-codigo]').evaluateAll((els,imgs)=>els.forEach((e,i)=>{
        const img=document.createElement('img');img.src=imgs[i];e.replaceChildren(img);
      }),imagenes);
      await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode()));await document.fonts.ready;});
      await page.locator('.etiqueta .texto').evaluateAll(textos=>textos.forEach(texto=>{
        const etiqueta=texto.closest('.etiqueta'),ancho=parseFloat(getComputedStyle(etiqueta).width);
        if(Math.abs(ancho-90*96/25.4)>2)return;
        const escala=etiqueta.getBoundingClientRect().width/ancho;
        if(!escala)return;
        const campos=[...texto.children];
        const altoNecesario=()=>campos.reduce((n,c)=>n+c.getBoundingClientRect().height/escala,0)+parseFloat(getComputedStyle(texto).rowGap||0)*Math.max(0,campos.length-1);
        for(let paso=0;paso<16 && altoNecesario()>texto.clientHeight;paso++){
          let cambio=false;
          for(const c of campos){
            const piso=c.classList.contains('nombre')?16:c.classList.contains('recibe')?9.33:12;
            const actual=parseFloat(getComputedStyle(c).fontSize);
            if(actual>piso){c.style.fontSize=Math.max(piso,actual-0.67)+'px';cambio=true;}
          }
          if(!cambio)break;
        }
      }));
      const archivoEtiquetas=path.join(preparacion,'etiquetas.pdf');
      await page.pdf({path:archivoEtiquetas,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:false});
      await browser.close(); browser=null;
      await log(`${fecha}: preparados ${pedidos.count} pedidos. Comanda 58 mm y etiquetas 200 × 62 mm horizontal.`);
      if(modo==='preparar') await log('Solo vista previa. No se envió nada a las impresoras.');
      else {
        for(const [doc,impresora,archivo] of [['comanda',config.comanda,archivoComanda],['etiquetas',config.etiquetas,archivoEtiquetas]]) {
          if(!puedeEnviar(estado,doc)) {await log(`${fecha}: ${doc} ya figura ${estado[doc].estado}; no se repite.`);continue;}
          estado[doc]={estado:'enviando',fecha:new Date().toISOString(),impresora};
          await guardarEstado(archivoEstado,estado);
          await sumatra(argumentosImpresora(impresora,archivo));
          estado[doc].estado='enviado_a_windows';
          await guardarEstado(archivoEstado,estado);
          await log(`${fecha}: ${doc} enviado a la cola de ${impresora}. Confirme la salida física.`);
        }
      }
    }
  }
} catch(e) {
  // No imprimir URL, cabeceras ni credenciales en los registros.
  await log(`ERROR: ${String(e.message).split(clave).join('[oculto]')}`);
  process.exitCode=1;
} finally {
  if(browser) await browser.close();
  if(bloqueo) { await bloqueo.close(); await unlink(archivoBloqueo); }
}
