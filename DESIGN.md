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

Los Excel de operación y facturación requieren imágenes PNG incrustadas para conservar los logos
en Excel de Mac y Windows. Las copias de `assets/reportes/` derivan de los SVG
aprobados de Go Lunch, Alefer y Glovis; se usan en el archivo descargado y no
reemplazan las marcas SVG de la interfaz. La descarga presenta Resumen, Entregas,
Pendientes_Registro e Incidencias_Sin_Cargo, con encabezados de fecha y selección,
nombres y números de empleado, filas ajustadas al texto y encabezados congelados.
Facturación reutiliza este formato en Resumen_Facturacion y Auditoria_Detalle,
sin Calificaciones, Filtros ni teléfonos. Cada descarga consulta datos actuales;
conserva las conciliaciones sin fabricar hora real y excluye las incidencias del
cargo. El precio unitario capturado se aplica a ambos servicios; subtotal sin IVA.

## Principios

- Una pantalla, una tarea principal. Las funciones administrativas se agrupan
  por contexto y las pruebas nunca compiten con la operación diaria.
- En móvil, la acción principal permanece accesible y el contenido puede crecer
  mediante scroll sin comprimir controles ni listas.
- Las zonas, turnos y horarios se muestran con nombres operativos, no con claves
  internas de base de datos.
- Los estados críticos se dicen con texto además de color: lista actualizada,
  lista guardada, falta lista de hoy, pendiente,
  entregado, cerrado, no verificado y fuera de zona.
- Los controles táctiles tienen al menos 44 px de alto y foco visible.
- Los cambios de apariencia deben conservar IDs, contratos de datos y la clase
  `.oculto` de las PWA existentes.

## Pedidos de cobertura

Los campos de platillos del panel comparten una escala: 0.8125 rem (13 px con la configuración predeterminada) en computadora para menú regular diario, tabla semanal y opciones diarias de coberturas. En pantallas pequeñas o con puntero táctil conservan 1 rem (16 px). Las dos pestañas de Menú aprovechan hasta 1240 px del contenido, con padding exterior de 16 px y tarjetas de 16 px. La tabla regular distribuye las seis opciones en el ancho disponible; la fecha ocupa 108 px y su botón Editar pasa debajo. Las celdas usan padding de 6 px y altura mínima de 3 rem que crece con el texto, incluida su alternativa sin `field-sizing`. Solo cuando el contenedor baja de 640 px se habilita desplazamiento horizontal con un ancho mínimo de 720 px; el resto del panel conserva su ancho habitual. La pestaña Menú de coberturas reduce separaciones y padding; los campos táctiles conservan al menos 48 px. La escala de los documentos impresos es independiente.

El menú de Coberturas se programa de lunes a domingo, con tres opciones variables por fecha y publicación independiente por día. La vista mantiene la identidad corporativa y usa filas con fecha, estado, tres campos y una acción; en móvil los campos se apilan. Publicado, Cambios sin publicar y Sin menú se expresan con texto. Solo administración publica; gerente consulta. Hoy y futuro admiten una nueva publicación con control de versión; el pasado conserva el historial. Los borradores se conservan ante errores y se confirma antes de descartarlos al consultar otra semana.

Cada folio guarda sus tres opciones originales de forma inmutable. La publicación nueva aplica a nuevas altas, que comprueban la versión del menú dentro de la transacción. La edición de un folio conserva su propio menú, platillos y QR. La anticipación de dos horas, límites de edición, entregas e incidencias se mantienen. Los formularios atrasados deben actualizar; reintentar una confirmación recupera el folio original aunque haya otra publicación. La programación semanal reemplaza los formularios de vigencia y de cambio de un día en el panel; los periodos existentes se muestran por fecha.

La solicitud del supervisor se presenta como una lista de personas y alimentos,
no como una orden financiera. La pantalla muestra únicamente horario, menú,
zona, responsable y beneficiarios. Costos y acuerdos comerciales no aparecen.

El panel distribuye las funciones de cobertura por tarea: programación en Menú, consulta y pedidos extraordinarios en Pedidos, supervisores y vigencias en Empleados e impresión por turno y folio en Cocina. La navegación lateral no contiene Coberturas. En reparto se conserva el mismo patrón de escaneo individual.

Los supervisores conservan su número y clave; pueden crear varios folios para hoy con turno, zona, responsable y hora propios. Altas, modificaciones y cancelaciones requieren al menos dos horas antes de la entrega, comprobadas por el reloj del servidor y la función transaccional de PostgreSQL. Un cambio de horario también debe respetar el límite del horario anterior. Mis pedidos de hoy muestra folios confirmados, entregados y cancelados. Cada empleado admite una cobertura por turno y día entre todos los supervisores y zonas; puede tener otra en el otro turno y su pedido regular.

El menú especial es compartido. El panel revisa cada 30 segundos y alerta por cada folio nuevo o modificado, mostrando turno, zona y hora; intenta imprimir solo ese folio y conserva la acción manual de respaldo. La confirmación de impresión se identifica por folio y revisión, de modo que un cambio con igual cantidad vuelve a avisar. La alarma solo se apaga cuando el operador confirma Comanda impresa. Los botones por folio conviven con los consolidados por turno.

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

Las vistas «Comidas y entregas» y «Empleados» se seleccionan con pestañas subrayadas y navegación por teclado. La primera es la entrada predeterminada y contiene únicamente comidas, con filtros Todas, Por entregar, Entregadas y No surtidas · Sin cargo. El desglose regular/cobertura permanece junto al total solicitado; las tardías son un subconjunto de entregadas. La acción de incidencia conserva la identidad original de la comida al filtrar.

Empleados contiene únicamente la plantilla activa: Activos = Con pedido + Sin pedido. Dentro de Sin pedido aparecen Ingresaron y Sin ingreso registrado como subgrupos, nunca como cifras paralelas a su total. La vista se abre en Sin pedido y cuenta cada persona una sola vez. Si no hay datos de accesos, los subgrupos quedan desactivados y sus cifras son desconocidas; no se atribuye una ausencia de ingreso. Las comidas históricas de personas inactivas permanecen en Comidas y entregas.

En escritorio, las tablas semánticas permiten desplazamiento con encabezados visibles y texto completo. En móvil, las filas se apilan y cada celda conserva su etiqueta. Los filtros ofrecen áreas de al menos 48 px. El refresco conserva la selección y el desplazamiento; el reporte diario continúa generando toda la fecha de servicio, independientemente del filtro de pantalla.

## Etiquetas de reparto

Formato predeterminado horizontal de 200 × 62 mm: rollo Brother de 62 mm y corte de 200 mm. Los 110 mm adicionales quedan en blanco únicamente en el extremo izquierdo para cerrar recipientes de polipropileno. El bloque impreso de 90 × 62 mm conserva exactamente sus fuentes, márgenes interiores de 9 mm, distribución, QR de 32 mm, número de empleado y fecha. No se añade espacio al extremo derecho ni se amplía el contenido. La pestaña se usa para el cierre y el QR permanece sobre una cara plana del recipiente.

Las coberturas conservan su calibración física al 85 %, centrada dentro del bloque de 90 mm situado después de la pestaña izquierda. La escala del navegador es 100 % y el marco completo mide 200 × 62 mm, una sola página por etiqueta. El formato anterior de 90 × 62 mm permanece seleccionable, con su diseño y calibración previos.

## Identificación del paquete en reparto

Entrega abre cámara o usa el lector configurado, sin pedir recorrido, salida, llegada ni selección de servicio. La lista incluye regulares y coberturas de todas las zonas autorizadas. El escaneo individual usa el pedido descargado para determinar zona, turno y horario; la etiqueta nueva agrega zona y empleado a la fecha (más código único en cobertura), sin codificar la hora. El escaneo registra hora real y GPS disponible. Se conservan etiquetas anteriores, colas y bitácora histórica, sin generar marcas nuevas de recorrido.

**Regla de una comida por confirmación.** Cámara y lector identifican cada paquete por QR. La captura por número de empleado se conserva para etiqueta dañada: muestra nombre, platillo, zona y horario, permite elegir entre coincidencias y confirma una comida específica. El método cámara/lector/manual queda auditado. El responsable previsto del folio se conserva sin afirmar verificación de identidad al escanear. La cola guarda fecha, zona y turno de cada pedido. El servidor verifica nuevamente su asignación y los permisos del usuario; los registros antiguos sin contexto permanecen para revisión, salvo confirmación previa del servidor.

El lector procesa video desde que hay una imagen actual disponible, sin esperar
que el navegador declare toda la reproducción preparada. Un cuadro inválido se
reintenta sin detener silenciosamente el ciclo. La carga de análisis se limita y
alterna imagen completa y centro; los mensajes caben en el visor móvil. Se
conservan jsQR local, la lectura sin conexión y los códigos de las etiquetas.

**Regla de lista disponible.** La descarga de hoy reúne todas las zonas autorizadas, horarios, puntos y datos GPS disponibles para continuar sin señal. Los estados textuales «Lista actualizada», «Lista guardada» y «Falta lista de hoy» describen la disponibilidad de la jornada; una indicación de conexión del navegador por sí sola no garantiza actualización. Una lista de hoy guardada permite nuevas marcas sin conexión; una de ayer no. La cola conserva cada entrega aunque cambie el servicio o el día y nunca se borra para resolver errores. Cámara, GPS y sincronización requieren la app abierta y visible. Se conservan estilos y formatos carta de los impresos y el manual.

## Puntos de entrega y propuestas históricas

Administración conserva la captura directa de puntos en Reparto y puntos, desde un móvil físicamente en ASLA o REFIS. Las propuestas previas del repartidor se mantienen y sincronizan para revisión; aprobar crea un punto faltante sin reemplazar uno existente. El repartidor ya no configura puntos ni requiere una referencia oficial para escanear. Ni una propuesta ni una captura administrativa confirman comidas. Los controles administrativos y formatos de impresión conservan sus permisos y medidas.

## Acceso de supervisores desde portada

El enlace a /cobertura.html está disponible tanto en la identificación como en el estado cerrado o sin menú del servicio regular. El corte regular no oculta la entrada de supervisores; la autorización, el menú de hoy y la anticipación de dos horas se verifican dentro de su propio flujo. No se ofrecen pedidos cuando ya no cabe una entrega con ese margen dentro del mismo día.

## Autorización de pedidos extraordinarios

En Coberturas, gerente o administrador conserva el registro extraordinario de hoy cuando haya ventana de preparación y entrega. El formulario pide personas y platillos del menú especial vigente, responsable, zona, turno, hora futura de entrega y motivo. Registra rol autorizador y hora del servidor, conserva folios entregados y usa una clave de reintento para evitar duplicaciones. La confirmación ofrece comanda y etiquetas del folio nuevo. Este permiso administrativo es independiente de la anticipación obligatoria de dos horas del supervisor. El consolidado identifica horarios programados y reparto conserva esa hora también sin señal.

La hora se captura como texto de 24 horas, con ejemplo 17:30 = 5:30 p. m., para evitar segmentos AM/PM incompletos en Safari. La validación del formulario identifica el campo en español, lo enfoca y lo desplaza al centro de la vista. Los errores conservan las filas y el resto de los datos; el servidor mantiene la validación de hora futura del mismo día.

## Checklist de salida

En Cocina → Impresión, el checklist comparte fecha, turno y zona con los demás impresos. Lista comidas regulares y coberturas existentes, con folio y horario propio, y separa cada lote por zona/turno en papel carta. Las hojas de continuación repiten identificación y se numeran; una sola firma y hora real de salida se capturan a mano al final de cada lote.

## Márgenes y paginación de impresos

Los documentos carta usan márgenes de 14 mm. Al imprimir, el checklist sigue flujo normal, sin altura mínima ni pie empujado con flex: Safari debe mantener conteo, continuación y firma dentro de su hoja. Listas y menús repiten cabeceras y evitan cortar filas. Las etiquetas en carta se distribuyen en filas de elementos indivisibles; el rollo conserva sus medidas y márgenes calibrados. Las comandas de 58 mm mantienen un área propia con margen vertical repetido de 2 mm.

## Orden del checklist por menú

Dentro de cada lote de turno y zona, el checklist agrupa por opción en el orden del menú y ordena por número de empleado de forma numérica, con nombre como desempate. Opción, número y nombre son las primeras columnas; horario y casilla quedan al final. Cada grupo muestra platillo original y total de la opción. La paginación reserva espacio para encabezados y nombres largos, conserva las continuaciones identificadas y una sola firma al final del lote.

## Reportes consolidados

Cocina, comanda general, etiquetas, checklist y los Excel usan la misma consulta de comidas regulares y coberturas vigentes, incluidas extraordinarias. Cada comida tiene identidad y estado propios; una misma persona puede aparecer varias veces. Los reportes separan Regulares, Coberturas y Total, con filtros de fecha, turno, zona y servicio. Los impresos de folio y las alarmas de supervisores permanecen disponibles para imprimir solo nuevos agregados.

Las extraordinarias usan la hora autorizada para preparación y puntualidad. Las calificaciones solo incluyen regulares, que son los que permiten encuesta. Facturación aplica temporalmente el mismo costo unitario a ambos servicios, decisión confirmada por Francisco el 7/nov/2026; muestra entregados y pendientes con cargo para conciliación y separa las incidencias sin cargo, excluidas de los servicios facturables y el subtotal pero conservadas en el detalle auditado. Un error de lectura de coberturas no se presenta como una lista completa. Los formatos de papel, QR y calibraciones físicas se conservan.

## Integridad de los folios de supervisor

Cada alta usa una clave de reintento para recuperar el mismo folio si se pierde la respuesta. Edición y cancelación se dirigen a un ID propio y comparan la versión leída; una sesión atrasada debe actualizar. Ningún folio con entregas iniciadas se modifica o cancela. Los empleados que permanecen en un folio editado conservan su QR; si cambia la preparación u horario, cocina sustituye los impresos previos por los actualizados. Las cancelaciones conservan el historial y liberan la asignación de cobertura. Las funciones anteriores quedan limitadas a folios legados y no sobrescriben lotes nuevos durante la transición.

## Reporte diario para el cliente

Extensión del mundo corporativo operativo existente: Dashboard comparte la fecha de servicio con «Reporte diario / PDF» y ofrece «Elaboró» opcional. El documento usa Arial local, papel carta vertical y márgenes de 14 mm; incrusta los SVG aprobados de Go Lunch y Glovis. Conserva blanco y tablas legibles, negro al imprimir y azul de marca en los controles de pantalla. En móvil, la hoja permite desplazamiento horizontal indicado sin ocultar los controles.

**Regla de conciliación por comida.** La primera hoja muestra seis indicadores: regulares solicitadas + coberturas solicitadas = total solicitado; entregadas + pendientes + no surtidas sin cargo = total solicitado. El detalle de entregas incluye únicamente entregas registradas sin incidencia, agrupadas por turno y zona, con número de empleado, nombre, platillo, servicio, folio cuando corresponde, hora prevista y entrega registrada. Cada comida conserva su identidad aunque la misma persona reciba varias; las extraordinarias muestran su propia hora autorizada. Cada grupo cierra con subtotal de regulares, coberturas y total; el cierre diario repite ese desglose de entregadas. Las continuaciones repiten marcas, fecha, generación, identificación del grupo y columnas; todas las hojas llevan numeración «Página n de N». «Elaboró» aparece solo si se captura; no se pide firma, porque el reporte se envía por correo.

Es una fotografía de los registros disponibles al generarlo: sincronizar primero los escáneres de reparto y regenerar si faltaban entregas. «Imprimir / Guardar PDF» abre el diálogo nativo: carta vertical, escala 100 % y encabezados/pies del navegador desactivados. El operador guarda el PDF y lo adjunta al correo.

La vista diaria reutiliza `ImpresionPanel.abrir`, igual que los menús y las listas. Se muestra dentro de la pestaña actual y conserva la sesión, la fecha y el desplazamiento del dashboard. «Volver al panel» permanece fuera del iframe de la hoja, disponible mientras se desplaza el reporte y excluido de la impresión. Se restaura el foco al botón que abrió la vista. Una respuesta cuya fecha ya no coincide con el selector se descarta antes de abrirla; los errores dejan al operador en el dashboard con un aviso.

La consulta `/api/reporte-entregas/:fecha` devuelve HTML con `no-store`, bajo autorización de admin o gerente; la clave viaja en `x-admin-key` y no se incorpora a la URL ni al documento imprimible/PDF. Reutiliza la consulta de comidas vigente y da prioridad a las incidencias sin cargo sobre cualquier marca previa de entrega.

## Incidencias sin cargo

Extensión del mundo operativo existente, con la misma paleta, tipografía, controles y tablas. Dashboard ofrece «Registrar no surtido» por comida regular o de cobertura a admin y gerente. El diálogo identifica fecha, empleado, platillo y folio cuando corresponde; presenta motivo obligatorio en una línea (5–500 caracteres), confirmación explícita de que cocina o reparto no surtió la comida, «Cancelar» y «Autorizar sin cargo». Si existe entrega registrada, advierte antes de autorizar. El foco inicial va al motivo, los errores aparecen dentro del diálogo y conservan el texto, y los controles se bloquean durante el registro. El rol procede de la sesión y la hora del servidor.

**Regla de incidencia visible.** El estado «No surtido · Sin cargo» se expresa con texto y fondo neutro, acompañado por motivo, rol y fecha/hora. Tiene prioridad sobre la entrega previa; esa marca se conserva y se identifica como «Marca previa rectificada». No se presenta como entrega pendiente ni como falta de recogida del empleado. Dashboard y PDF cuentan las incidencias por separado; producción conserva las solicitudes originales. Las incidencias se excluyen de entregadas, pendientes, no recogidos, merma por empleado, encuesta y puntualidad. Reparto no ofrece esas comidas; un escaneo atrasado no revierte la incidencia y un folio que la contiene no admite edición ni cancelación.

**Regla de conciliación sin cargo.** El PDF mantiene logos aprobados, carta vertical y márgenes de 14 mm. «Incidencias sin cargo» forma grupos por turno y zona, con empleado, platillo, servicio, folio cuando corresponde, motivo y autorización por rol/hora. Conserva cabeceras, continuaciones y numeración; los motivos largos crecen en las filas sin recortarse. El Excel de operación incluye «Incidencias_Sin_Cargo» y facturación conserva «Auditoria_Detalle» aun cuando excluye esas comidas del cargo. El manual indica regenerar y reemplazar ante RRHH cualquier PDF previamente enviado; la app no modifica nómina externa. Se mantiene la regla de cobro para quien realmente no recoge su comida; esta extensión no activa OTP ni WhatsApp.

### Monitoreo de solo lectura

El usuario monitoreo abre el dashboard del día y navega entre pedidos, coberturas,
recorridos y reportes. Descarga PDF/Excel y conserva filtros de consulta, sin
acciones de edición, autorizaciones, incidencias o entrega. El aviso de sesión
explica el alcance. No activa alarma ni impresión automática de cocina. La
autorización del servidor es obligatoria, además de ocultar controles.

## Pedidos integrados

Pedidos consulta la misma fuente de comidas que los reportes y reúne regulares y coberturas vigentes, incluidas las extraordinarias. Una fila corresponde a una comida; nombre y número de empleado permanecen juntos, servicio y folio identifican la cobertura, y el horario autorizado se conserva. La tabla semántica tiene cabeceras, región con foco para desplazamiento horizontal, estados de carga, vacío y error, y descarta respuestas de fechas anteriores. Sus totales separan regulares y coberturas y usan la misma prioridad de incidencias y conciliaciones que Dashboard. No se habilitan acciones nuevas de entrega.

La etiqueta visible es «Pendientes de registro» en panel, PDF y Excel; no significa que el empleado no recogió. Operación usa la pestaña Pendientes_Registro. La entrega confirmada por administración cuenta como entregada sin inventar hora de escaneo; las incidencias sin cargo conservan prioridad.

Dashboard ofrece al administrador «Registrar entregas omitidas», visible junto a los reportes de la fecha consultada. El diálogo nativo identifica fecha, permite filtrar turno/zona/servicio y seleccionar únicamente comidas pendientes con horario cumplido; cambiar filtros limpia la selección. Requiere motivo y confirmación explícita de entrega física. Conserva el motivo y el intento si falla la conexión, bloquea doble envío y exige volver a consultar ante un conflicto. Cancelar permanece visible y el navegador gestiona foco, Escape y retorno al botón. Gerente, monitoreo y reparto no ven la acción y el servidor rechaza su uso. La confirmación actualiza las comidas de manera atómica y conserva marcas reales e incidencias. PDF y ambos Excel identifican «Reportada como entregada por el administrador»; en la columna compacta de cada hoja PDF se usa «Admin» con leyenda completa, reservando espacio carta para ella.

## Organización del panel por tarea

Menú contiene dos pestañas internas, Menú regular y Menú de coberturas, con sus propios campos y estado. Las pestañas usan botones, roles tablist/tab/tabpanel, selección y foco sincronizados; flechas/Home/End mueven foco, Enter/Espacio activan explícitamente por tratarse de una carga de red. Esta interacción compatible con Safari no requiere dependencias. El estado inicial oculto se declara en HTML. Cambiar de pestaña no recarga ni descarta borradores de coberturas.

Pedidos muestra una única tabla y filtros nativos Todos, Regulares y Coberturas. La consulta conserva fecha y servicio, descarta respuestas obsoletas y sus conteos corresponden a la selección. El folio abre el detalle cerrado de ese grupo, con responsable, horario y una tabla por comida; no habilita entregas ni impresiones en esa vista. Los pedidos extraordinarios se registran en un bloque desplegable de Pedidos.

Empleados presenta Supervisores de coberturas siempre visible al inicio, con título de sección, Registrar supervisor y Autorizaciones vigentes. Ambos bloques comparten la tarjeta y se distribuyen en dos columnas en computadora y una en móvil; conservan autorización, vigencias y restablecimiento de claves. Administración y gerente conservan sus permisos previos sobre supervisores; gerente sigue sin editar plantilla ni menús. Monitoreo consulta Pedidos y folios sin permisos de escritura. Su acceso Cocina y recorridos conserva la bitácora y los impresos de coberturas mediante dos vistas de consulta; las herramientas generales y las mutaciones permanecen ocultas.

Cocina conserva el consolidado de impresión y agrega Producción por folio de cobertura, con fecha/turno propios, conteos de folios y comidas solicitadas y detalles inicialmente cerrados. Las ayudas de impresora se despliegan a demanda. Pedido confirmado se distingue de Entregadas; las incidencias prevalecen sobre las marcas previas. Las alertas por folio nuevo/modificado y la confirmación Comanda impresa mantienen su funcionamiento en toda la sesión. Se elimina el badge ambiguo de la antigua pestaña de Coberturas.

Los estados de entrega de Pedidos y del detalle por folio comparten el mismo formato. Entregado usa verde corporativo y peso 700; la hora o la confirmación administrativa aparecen debajo. Los pendientes y las incidencias conservan texto propio y nunca reciben el estado verde. El detalle de cobertura utiliza tabla semántica con empleado/número, platillo, hora prevista y entrega, desplazable con teclado y tacto en pantallas pequeñas.

## Escaneo directo de entregas (v91)

La tarea principal es abrir cámara y escanear cada paquete. No se pide elegir zona, servicio, iniciar ruta ni marcar salida, llegada o regreso. Una sola acción visible abre/cierra la cámara; debajo queda Etiqueta dañada con búsqueda y confirmación individual. La jornada reúne regulares y coberturas de las zonas autorizadas. Cada registro usa la zona y el turno del pedido descargado, hora real del escaneo y GPS disponible; la ausencia de GPS no bloquea. El responsable de cobertura permanece como previsto, sin afirmar verificación del receptor. Las etiquetas nuevas llevan empleado, fecha y zona (más el código único en cobertura); el horario no se codifica. Se leen los formatos anteriores, se rechazan diferencias entre QR y pedido y no se elige arbitrariamente entre coincidencias. Las colas históricas permanecen y se sincronizan sin generar marcas nuevas. La confirmación exige guardar primero en el equipo; fallos de almacenamiento se muestran como entrega no registrada.

La prueba del escáner admite Reparto general: confirma lectura, sin afirmar identidad ni permisos personales. Solo la sesión personal comprueba sus zonas. Reconocer el QR de prueba detiene la cámara, sin alterar pedidos o colas. Cambiar usuario detiene la cámara y, cuando quedan registros por subir, enfoca el aviso situado al inicio del contenido; se mantiene el bloqueo de cambio de identidad hasta sincronizar.

Desde el servicio del 26/nov/2026, la puntualidad usa 20 minutos inclusivos después de la hora programada; fechas anteriores conservan 15. La regla compartida por fecha alimenta Dashboard, API, reportes y Entrega sin conexión, aunque una caché anterior indique 15. Las coberturas extraordinarias mantienen su hora autorizada como base. No se ajustan las horas de escaneo ni se inventa puntualidad para conciliaciones sin hora real.
