using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace VisorDatosSIG.Web.Controllers;

// Las páginas solo entregan la estructura (Razor). Los datos llegan por /api (proxy al backend)
// y la autorización se valida aquí (página) y en el backend (servicio): nunca solo ocultando botones.

public sealed class InicioController : Controller
{
    public IActionResult Index() => View();

    [AllowAnonymous]
    public IActionResult Error() => View("Error", Activity.Current?.Id ?? HttpContext.TraceIdentifier);

    [AllowAnonymous]
    public IActionResult Estado(int codigo)
    {
        ViewData["Codigo"] = codigo;
        return View();
    }
}

public sealed class VisorController : Controller
{
    public IActionResult Index() => View();
}

public sealed class ConsultasController : Controller
{
    public IActionResult Index() => View();
}

[Authorize(Policy = "Administrador")]
public sealed class AdministracionController : Controller
{
    public IActionResult Usuarios() => View();
    public IActionResult Permisos() => View();
    public IActionResult Configuracion() => View();
    public IActionResult Capas() => View();
    public IActionResult Migraciones() => View();
    public IActionResult Bitacora() => View();
}

// ---------- Parte 2: operaciones de campo ----------

/// <summary>Visualización general en 2D/3D (MapLibre GL).</summary>
public sealed class MapaController : Controller
{
    public IActionResult Index() => View();
}

[Authorize(Policy = "Administrador")]
public sealed class DashboardController : Controller
{
    public IActionResult Tecnico() => View();
}

[Authorize(Policy = "Administrador")]
public sealed class AsignacionesController : Controller
{
    public IActionResult Cortes() => View("Index", "Corte");
    public IActionResult Reconexion() => View("Index", "Reconexion");
}

[Authorize(Policy = "Administrador")]
public sealed class EjecucionController : Controller
{
    public IActionResult Cortes() => View("Index", "Corte");
    public IActionResult Reconexion() => View("Index", "Reconexion");
}

[Authorize(Policy = "Administrador")]
public sealed class MonitoreoController : Controller
{
    public IActionResult Index() => View();
}

public sealed class CuentaController : Controller
{
    [AllowAnonymous]
    public IActionResult Login(string? returnUrl)
    {
        if (User.Identity?.IsAuthenticated == true) return LocalRedirect(Url.IsLocalUrl(returnUrl) ? returnUrl! : "/");
        ViewData["ReturnUrl"] = Url.IsLocalUrl(returnUrl) ? returnUrl : "/";
        return View();
    }

    [AllowAnonymous]
    public IActionResult AccesoDenegado() => View();

    public IActionResult Perfil() => View();

    public IActionResult Salir() => View();
}

public sealed class AyudaController : Controller
{
    public IActionResult Manual() => View();
    public IActionResult AcercaDe() => View();
}
