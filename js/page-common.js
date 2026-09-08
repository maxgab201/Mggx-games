// ============================================================
//  MGGX GAMES — Flujo de descarga compartido por las páginas de
//  producto (advertencia → elegir versión → donación → descarga).
//
//  Reemplaza los seis js/page.js por producto, que eran el mismo
//  archivo copiado: idénticos salvo comentarios en gas-station,
//  craft-book, autoclicker, modmedic y laberinto, y con dos
//  funciones de más en wtsapp para su rama de Android. Copiar ya
//  había empezado a costar: cada producto nuevo sumaba una copia
//  más y las variantes se iban despegando entre sí.
//
//  Script clásico (no módulo) a propósito: js/motion.js despacha
//  los data-page-act buscando las funciones por nombre en window,
//  así que tienen que ser globales. Y archivo externo, también a
//  propósito: la CSP de producción (script-src 'self', sin
//  'unsafe-inline') bloquea los <script> embebidos en el HTML.
//
//  Configuración por página vía data-* en la propia etiqueta
//  <script>, en vez de un archivo de config por producto:
//
//      <script src="../js/page-common.js" data-has-android></script>
//
//  data-has-android  además del flujo de PC, define el de Android
//                    (#warningAndroidModal / #downloadAndroidModal).
//                    Hoy solo lo usa WtsApp.
// ============================================================

(function () {
    var config = document.currentScript ? document.currentScript.dataset : {};
    var hasAndroid = config.hasAndroid !== undefined;

    var pendingDownloadUrl = null;

    function show(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    }

    function hide(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    // Cierra por clase y no por una lista de IDs escrita a mano: así la
    // misma función sirve para las páginas de tres modales y para la de
    // cinco, y una página que agregue un modal nuevo no necesita que
    // nadie se acuerde de sumarlo acá.
    function cerrarTodo() {
        document.querySelectorAll('.modal').forEach(function (el) {
            el.style.display = 'none';
        });
    }

    function ejecutarDescarga() {
        if (pendingDownloadUrl) {
            window.location.href = pendingDownloadUrl;
            pendingDownloadUrl = null;
        }
        cerrarTodo();
    }

    window.abrirAdvertencia = function () { show('warningModal'); };

    window.pasarAVersiones = function () {
        hide('warningModal');
        show('downloadModal');
    };

    // La llama render-versions.js al elegir una versión de la lista.
    window.iniciarDescarga = function (url) {
        pendingDownloadUrl = url;
        cerrarTodo();
        show('donationModal');
    };

    window.donarYDescargar = function () {
        window.open('https://ko-fi.com/mggxgames', '_blank');
        ejecutarDescarga();
    };

    window.descargarSinDonar = ejecutarDescarga;
    window.ejecutarDescarga = ejecutarDescarga;
    window.cerrarTodo = cerrarTodo;

    if (hasAndroid) {
        window.abrirAdvertenciaAndroid = function () { show('warningAndroidModal'); };
        window.descargarAndroid = function () {
            hide('warningAndroidModal');
            show('downloadAndroidModal');
        };
    }

    // Clic en el fondo oscuro (el propio .modal, no su contenido) cierra.
    // addEventListener en vez de window.onclick = ... : asignar la
    // propiedad pisaría cualquier otro handler global, y js/motion.js
    // también escucha clicks en document para su delegación.
    document.addEventListener('click', function (event) {
        if (event.target.classList && event.target.classList.contains('modal')) cerrarTodo();
    });
})();
