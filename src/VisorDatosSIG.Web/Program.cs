using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

builder.Services.AddControllersWithViews();

// Mismas claves y misma cookie que BackendSIG: el backend emite la sesión y el frontend la
// valida para proteger las páginas y construir el menú según el perfil (RF-SEG-04).
var rutaClaves = config["Seguridad:RutaClaves"];
if (string.IsNullOrWhiteSpace(rutaClaves))
    rutaClaves = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VisorDatosSIG", "claves");
var dpBuilder = builder.Services.AddDataProtection()
    .SetApplicationName("VisorDatosSIG")
    .PersistKeysToFileSystem(new DirectoryInfo(rutaClaves));
if (OperatingSystem.IsWindows())
    dpBuilder.ProtectKeysWithDpapi(protectToLocalMachine: true);

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = ".VisorSIG.Auth";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        o.ExpireTimeSpan = TimeSpan.FromMinutes(config.GetValue("Seguridad:MinutosInactividad", 20));
        o.SlidingExpiration = true;
        o.LoginPath = "/Cuenta/Login";
        o.AccessDeniedPath = "/Cuenta/AccesoDenegado";
        o.ReturnUrlParameter = "returnUrl";
        // Si el administrador bloquea al usuario, sus páginas también dejan de abrirse.
        o.Events.OnValidatePrincipal = VisorDatosSIG.Web.Componentes.ValidacionSesion.ValidarAsync;
    });

builder.Services.AddAuthorization(o =>
{
    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
    o.AddPolicy("Administrador", p => p.RequireRole("Administrador"));
});

// /api/* se reenvía al backend (mismo origen para el navegador: sin CORS y con cookie SameSite=Strict).
builder.Services.AddReverseProxy().LoadFromConfig(config.GetSection("ReverseProxy"));
builder.Services.AddHttpClient("backend", c =>
{
    c.BaseAddress = new Uri(config["Backend:Url"] ?? "http://localhost:5080/");
    c.Timeout = TimeSpan.FromSeconds(10);
});

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Inicio/Error");
    app.UseHsts();
    app.UseHttpsRedirection();
}

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    // OpenStreetMap exige un Referer válido en las peticiones de mosaicos del navegador:
    // "same-origin" no lo enviaba y el servidor respondía 403 "Access blocked".
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["X-Frame-Options"] = "DENY";
    h["Content-Security-Policy"] =
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com; " +
        // MapLibre (visualización 3D) descarga las teselas con fetch y usa su worker servido desde el propio sitio.
        "font-src 'self'; connect-src 'self' https://tile.openstreetmap.org https://server.arcgisonline.com; worker-src 'self'; " +
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    await next();
});

app.UseStatusCodePagesWithReExecute("/Inicio/Estado", "?codigo={0}");
app.UseStaticFiles();   // antes de la autorización: la pantalla de acceso necesita CSS/JS sin sesión
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapReverseProxy();
app.MapControllerRoute(name: "default", pattern: "{controller=Inicio}/{action=Index}/{id?}");

app.Run();
