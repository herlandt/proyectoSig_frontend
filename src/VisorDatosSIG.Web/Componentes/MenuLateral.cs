using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;

namespace VisorDatosSIG.Web.Componentes;

public sealed record OpcionMenu(int IdMenu, int? IdMenuPadre, int Nivel, string Nombre, string? Url, string? Icono, int Orden, List<OpcionMenu> Hijos);

/// <summary>
/// Menú lateral construido en el servidor con las opciones de dbo.UsuarioMenu del usuario
/// autenticado (vía API). Las opciones no autorizadas no se envían al navegador (Anexo E).
/// </summary>
public sealed class MenuLateralViewComponent(IHttpClientFactory http, ILogger<MenuLateralViewComponent> log) : ViewComponent
{
    public async Task<IViewComponentResult> InvokeAsync()
    {
        List<OpcionMenu>? menu = null;
        try
        {
            var cliente = http.CreateClient("backend");
            using var solicitud = new HttpRequestMessage(HttpMethod.Get, "api/cuenta/menu");
            if (Request.Headers.Cookie.Count > 0) solicitud.Headers.Add("Cookie", Request.Headers.Cookie.ToString());
            using var respuesta = await cliente.SendAsync(solicitud);
            if (respuesta.IsSuccessStatusCode)
                menu = await respuesta.Content.ReadFromJsonAsync<List<OpcionMenu>>();
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning(ex, "No se pudo obtener el menú del backend; se usa el menú básico por perfil.");
        }
        return View(menu ?? MenuBasico((ClaimsPrincipal)User));
    }

    /// <summary>Respaldo si el backend no responde: mismo Anexo E, filtrado por perfil.</summary>
    private static List<OpcionMenu> MenuBasico(ClaimsPrincipal usuario)
    {
        bool admin = usuario.IsInRole("Administrador");
        OpcionMenu M(string nombre, string icono, params (string Nombre, string Url, string Icono)[] hijos) =>
            new(0, null, 1, nombre, null, icono, 0, hijos.Select(h => new OpcionMenu(0, null, 2, h.Nombre, h.Url, h.Icono, 0, [])).ToList());
        // Misma estructura que database/07_Operaciones.sql (menú de la parte 2).
        var menu = new List<OpcionMenu>
        {
            admin
                ? M("Dashboard", "bi-speedometer2", ("Dashboard general", "/", "bi-pie-chart"),
                    ("Dashboard técnico", "/Dashboard/Tecnico", "bi-bar-chart-line"), ("Visualización general", "/Mapa", "bi-badge-3d"))
                : M("Dashboard", "bi-speedometer2", ("Dashboard general", "/", "bi-pie-chart"), ("Visualización general", "/Mapa", "bi-badge-3d")),
        };
        if (admin)
        {
            menu.Add(M("Asignaciones", "bi-signpost-split", ("Asignación de cortes", "/Asignaciones/Cortes", "bi-scissors"),
                ("Asignación de reconexión", "/Asignaciones/Reconexion", "bi-plug")));
            menu.Add(M("Ejecución", "bi-clipboard-check", ("Ejecución de cortes", "/Ejecucion/Cortes", "bi-check2-square"),
                ("Ejecución de reconexión", "/Ejecucion/Reconexion", "bi-check2-circle")));
            menu.Add(M("Monitoreo", "bi-broadcast", ("Monitoreo de personal", "/Monitoreo", "bi-person-walking")));
        }
        menu.Add(M("Información geográfica", "bi-map", ("Visor 2D y capas", "/Visor", "bi-globe-americas"),
            ("Consultas y filtros", "/Consultas", "bi-search")));
        if (admin)
            menu.Add(M("Administración", "bi-gear", ("Usuarios", "/Administracion/Usuarios", "bi-people"),
                ("Configuración operativa", "/Administracion/Configuracion", "bi-sliders"),
                ("Historial de migraciones", "/Administracion/Migraciones", "bi-clock-history"),
                ("Bitácora del sistema", "/Administracion/Bitacora", "bi-journal-text")));
        menu.Add(M("Cuenta", "bi-person", ("Mi perfil", "/Cuenta/Perfil", "bi-person-badge"), ("Cerrar sesión", "/Cuenta/Salir", "bi-box-arrow-right")));
        menu.Add(M("Ayuda", "bi-question-circle", ("Manual de usuario", "/Ayuda/Manual", "bi-book")));
        return menu;
    }
}
