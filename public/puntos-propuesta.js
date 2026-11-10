// Captura GPS para proponer un punto. Nunca modifica el punto oficial.
(() => {
  const valida = p => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 &&
    Number.isFinite(p.precision_m) && p.precision_m > 0 && p.precision_m <= 25;

  function resumirMuestras(muestras) {
    const buenas = muestras.filter(valida).sort((a,b) => a.precision_m-b.precision_m);
    if (!buenas.length) throw new Error('No se obtuvo una ubicación con precisión de 25 m o mejor. Quédate en el punto, a cielo abierto, y vuelve a intentar.');
    const elegidas = buenas.slice(0,Math.max(1,Math.ceil(buenas.length/2)));
    const lat = elegidas.reduce((n,p)=>n+p.lat,0)/elegidas.length;
    const lon = elegidas.reduce((n,p)=>n+p.lon,0)/elegidas.length;
    const rad = n=>n*Math.PI/180;
    const distancia = p => {
      const h=Math.sin(rad(p.lat-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(p.lat))*Math.sin(rad(p.lon-lon)/2)**2;
      return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
    };
    // Incluye la dispersión de las lecturas; el promedio no inventa precisión.
    const precision_m = Math.ceil(Math.max(...elegidas.map(p=>p.precision_m+distancia(p))));
    if (precision_m > 25) throw new Error('La ubicación varió demasiado entre lecturas. Quédate quieto en el punto y vuelve a intentar.');
    return {lat,lon,precision_m};
  }

  function medir(geolocation, {signal, progreso=()=>{}, limiteMs=25000, objetivo=8}={}) {
    return new Promise((resolve,reject) => {
      if (!geolocation?.watchPosition) return reject(new Error('Este equipo no tiene ubicación disponible. Actívala en el celular para enviar el punto.'));
      let id=null, terminado=false, reloj=null;
      const muestras=[];
      const limpiar=()=>{clearTimeout(reloj);if(id!==null)geolocation.clearWatch(id);signal?.removeEventListener('abort',abortar);};
      const acabar=error=>{
        if(terminado)return;terminado=true;limpiar();
        if(error)return reject(error);
        try{resolve(resumirMuestras(muestras));}catch(e){reject(e);}
      };
      const abortar=()=>{const e=new Error('Captura cancelada.');e.name='AbortError';acabar(e);};
      if(signal?.aborted)return abortar();
      signal?.addEventListener('abort',abortar,{once:true});
      reloj=setTimeout(()=>acabar(),limiteMs);
      try {
        id=geolocation.watchPosition(p=>{
          if(terminado)return;
          const m={lat:p.coords.latitude,lon:p.coords.longitude,precision_m:p.coords.accuracy};
          if(valida(m))muestras.push(m);
          progreso({lecturas:muestras.length,objetivo,precision_m:m.precision_m});
          if(muestras.length>=objetivo)acabar();
        },e=>{
          if(e.code===1)return acabar(new Error('Sin permiso de ubicación. Actívalo para esta app en los ajustes del celular y vuelve a intentar.'));
          if(muestras.length)return acabar();
          acabar(new Error('No se pudo medir la ubicación. Revisa el GPS y vuelve a intentar estando en el punto de entrega.'));
        },{enableHighAccuracy:true,maximumAge:0,timeout:limiteMs});
        // Algunos dispositivos o pruebas responden antes de devolver el id.
        if(terminado&&id!==null)geolocation.clearWatch(id);
      } catch(e) { acabar(e); }
    });
  }
  globalThis.GoLunchPuntos=Object.freeze({valida,resumirMuestras,medir});
})();
