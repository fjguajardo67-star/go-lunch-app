# Go Lunch — contrato de interfaz

## Dirección visual

Go Lunch es una herramienta operativa corporativa: debe sentirse clara,
confiable y rápida, no decorativa. La identidad se construye con azul marino,
azul Glovis, superficies blancas y fondos fríos. La firma aprobada es
`public/go-lunch.svg`; la interfaz recorta su isotipo cuando el espacio es
compacto. Glovis usa `public/glovis.svg` sobre superficies claras y
`public/glovis-white.svg` directamente sobre azul, sin placa ni padding.
Los PNG se conservan únicamente para favicons e íconos de instalación, donde
la compatibilidad del sistema operativo importa más que la escalabilidad. Esa
familia deriva sin redibujo de `assets/brand/go-lunch-3d.png`: el arte 3D
aprobado se conserva cuadrado, opaco y con su fondo blanco original.

La app usa la familia `public/icono-*` y el panel la familia `public/panel-*`.
Ambas muestran el mismo símbolo 3D para mantener continuidad entre pestañas,
accesos instalados y el Dock de macOS. La versión maestra del Dock es de
1024 px; las variantes de 16 a 512 px son reducciones directas del original.
Los demás originales autorizados, incluido el trazo monocromático, viven en
`assets/brand/` y no deben redibujarse desde CSS.

## Principios

- Una pantalla, una tarea principal. Las funciones administrativas se agrupan
  por contexto y las pruebas nunca compiten con la operación diaria.
- En móvil, la acción principal permanece accesible y el contenido puede crecer
  mediante scroll sin comprimir controles ni listas.
- Las zonas, turnos y horarios se muestran con nombres operativos, no con claves
  internas de base de datos.
- Los estados críticos se dicen con texto además de color: en línea, pendiente,
  entregado, cerrado, no verificado y fuera de zona.
- Los controles táctiles tienen al menos 44 px de alto y foco visible.
- Los cambios de apariencia deben conservar IDs, contratos de datos y la clase
  `.oculto` de las PWA existentes.

## Cobertura del segundo turno

La solicitud del supervisor se presenta como una lista de personas y alimentos,
no como una orden financiera. La pantalla muestra únicamente horario, menú,
zona, responsable y beneficiarios. Costos y acuerdos comerciales no aparecen.

El panel administrativo mantiene cuatro bloques: menú especial, supervisores
autorizados, solicitudes/producción y autorizaciones vigentes. En reparto, las
coberturas se distinguen visualmente, pero comparten el mismo patrón de escaneo
de las entregas regulares.

Cada turno tiene su propio conteo: A cierra 7:00 AM; B y horas extras, 2:00 PM (hora del servidor). El menú especial es compartido y la consulta, alarma, comanda y etiquetas distinguen el turno. Si hay solicitudes,
el panel interrumpe la operación con una alerta sonora y visual, intenta abrir
la impresión de la comanda y conserva una acción manual de respaldo. La alarma
solo se apaga cuando el operador confirma que la comanda quedó impresa.

## Crédito de desarrollo en la portada

La portada de identificación muestra «Desarrollado por» con el SVG original
`public/2j-logo.svg` de Double J Blacklabs. Se coloca en la esquina inferior
izquierda del escritorio; en móvil queda al pie de la portada con espacio
reservado, sin cubrir el formulario ni el acceso de supervisores. Solo aparece
en esa portada y conserva los colores y proporciones del archivo proporcionado.

El panel administrativo repite el crédito al pie de la barra lateral izquierda.
En escritorio la barra permanece visible al desplazar el contenido; en ventanas
bajas permite desplazamiento propio para mantener accesibles todas las opciones.
En móvil el crédito acompaña la fila de navegación horizontal.

## PWA y caché

Todo cambio dentro de `/public` debe acompañarse de un incremento de `VERSION`
en `public/sw.js`. Cualquier asset nuevo que deba funcionar sin señal se agrega
también a `PRECARGA`.

## Dashboard integrado

El total de comidas muestra el desglose de regulares y coberturas, incluidas extraordinarias vigentes. Los indicadores de empleados activos cuentan personas únicas; los de entrega cuentan comidas. Cada comida ocupa una fila que identifica empleado, servicio, folio y horario, de modo que una cobertura no sobrescriba un pedido regular. Se excluyen coberturas canceladas, se conserva el historial de empleados desactivados y las extraordinarias se califican contra su hora autorizada. El refresco de 30 segundos se mantiene.

Los indicadores se presentan en dos bloques con unidades explícitas: Comidas primero, con tarjetas Regulares, Coberturas, Total de comidas, Entregadas y Pendientes; Empleados después, con Activos, Con pedido, Vieron sin pedir y No abrieron. Las tardías se muestran como subconjunto de las entregadas. En móvil, Regulares y Coberturas comparten fila, Total ocupa el ancho y Entregadas/Pendientes quedan juntas debajo.

## Etiquetas de reparto

Formato predeterminado horizontal de 90 × 62 mm: rollo Brother de 62 mm y corte de 90 mm. Zona y horario de 21 pt ocupan la primera fila; nombre de 16 pt y platillo de 12 pt a la izquierda. QR de 32 mm con zona blanca a la derecha. Margen interior de 9 mm a ambos lados, con el contenido centrado y el QR conservando su tamaño; número de empleado y fecha de servicio en una fila inferior sin línea. Nombres y platillos largos se ajustan antes de imprimir. Los encabezados y pies externos se desactivan en el diálogo del navegador.

Las coberturas de 90 × 62 mm incorporan la calibración física indicada por operación: contenido al 85 %, centrado en un marco que conserva la medida del papel. La escala del navegador se mantiene en 100 %; cada marco sigue siendo una sola etiqueta. El ajuste de textos mide el diseño antes de la escala. Las etiquetas regulares conservan su calibración actual.

## Grupo activo de reparto

La app de entrega exige elegir Turno A o B junto a la zona; conserva esa elección únicamente para la misma fecha y zona. Llegada, listas y acciones se limitan a ese grupo. El cierre reúne únicamente regulares pendientes de dicho grupo, identifica zona/turno/cantidad en su confirmación y excluye siempre coberturas. El servidor verifica la asignación almacenada y la escritura vuelve a comparar zona y turno. Cada elemento de la cola mantiene su grupo; se sincronizan lotes separados y un registro antiguo sin contexto sigue pendiente de revisión, salvo que ya estuviera confirmado en servidor. No se modifican marcas históricas al publicar esta corrección.

## Selección de impresos de cocina

La tarjeta Impresión comparte fecha, turno (Todos/A/B) y zona (Todas/ASLA/REFIS) entre comanda y etiquetas. Los documentos identifican la selección y calculan sus cantidades después de filtrar los pedidos. Los tamaños de etiquetas y márgenes de impresión se conservan.

## Acceso de supervisores desde portada

El enlace a /cobertura.html está disponible tanto en la identificación como en el estado cerrado o sin menú del servicio regular. Los cortes regulares no ocultan la entrada de supervisores; la autorización y los cortes especiales se verifican dentro de su propio flujo.

## Autorización de pedidos extraordinarios

En Coberturas, gerente o administrador puede registrar un lote adicional para hoy cuando haya ventana de preparación y entrega. El formulario pide personas y platillos del menú especial vigente, responsable, zona, turno, hora futura de entrega y motivo. Registra rol autorizador y hora del servidor, conserva folios entregados y usa una clave de reintento para evitar duplicaciones. La confirmación ofrece comanda y etiquetas del folio nuevo. El consolidado identifica horarios autorizados y reparto conserva esa hora también sin señal. El corte y la alarma de supervisores permanecen independientes.

La hora se captura como texto de 24 horas, con ejemplo 17:30 = 5:30 p. m., para evitar segmentos AM/PM incompletos en Safari. La validación del formulario identifica el campo en español, lo enfoca y lo desplaza al centro de la vista. Los errores conservan las filas y el resto de los datos; el servidor mantiene la validación de hora futura del mismo día.

## Checklist de salida

En Cocina → Impresión, el checklist comparte fecha, turno y zona con los demás impresos. Lista solo pedidos existentes del servicio regular y separa cada lote por zona/turno en papel carta. Las hojas de continuación repiten identificación y se numeran; una sola firma y hora real de salida se capturan a mano al final de cada lote.

## Márgenes y paginación de impresos

Los documentos carta usan márgenes de 14 mm. Al imprimir, el checklist sigue flujo normal, sin altura mínima ni pie empujado con flex: Safari debe mantener conteo, continuación y firma dentro de su hoja. Listas y menús repiten cabeceras y evitan cortar filas. Las etiquetas en carta se distribuyen en filas de elementos indivisibles; el rollo conserva sus medidas y márgenes calibrados. Las comandas de 58 mm mantienen un área propia con margen vertical repetido de 2 mm.

## Orden del checklist por menú

Dentro de cada lote de turno y zona, el checklist agrupa por opción en el orden del menú y ordena por número de empleado de forma numérica, con nombre como desempate. Opción, número y nombre son las primeras columnas; horario y casilla quedan al final. Cada grupo muestra platillo original y total de la opción. La paginación reserva espacio para encabezados y nombres largos, conserva las continuaciones identificadas y una sola firma al final del lote.
