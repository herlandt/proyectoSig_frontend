using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace VisorDatosSIG.Web.Componentes;

/// <summary>
/// Las páginas confían en la misma cookie que la API, pero solo la API conoce el estado actual del
/// usuario. En cada página se pregunta al backend si la sesión sigue válida: si responde 401
/// (usuario bloqueado o con otro perfil) se cierra la sesión y se redirige al acceso.
/// Las rutas /api/* no se revisan aquí porque las valida la propia API al recibirlas por el proxy.
/// Si el backend no responde, no se expulsa a nadie: las llamadas de datos ya fallarán por sí solas.
/// </summary>
public static class ValidacionSesion
{
    public static async Task ValidarAsync(CookieValidatePrincipalContext ctx)
    {
        if (ctx.HttpContext.Request.Path.StartsWithSegments("/api")) return;
        if (ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier) is null) return;
        var servicios = ctx.HttpContext.RequestServices;

        HttpStatusCode? estado = null;
        try
        {
            var cliente = servicios.GetRequiredService<IHttpClientFactory>().CreateClient("backend");
            using var solicitud = new HttpRequestMessage(HttpMethod.Get, "api/autenticacion/actual");
            solicitud.Headers.Add("Cookie", ctx.HttpContext.Request.Headers.Cookie.ToString());
            using var respuesta = await cliente.SendAsync(solicitud, ctx.HttpContext.RequestAborted);
            estado = respuesta.StatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            servicios.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(ValidacionSesion))
                .LogWarning(ex, "No se pudo revalidar la sesión con el backend.");
        }

        if (estado == HttpStatusCode.Unauthorized)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        }
    }
}
