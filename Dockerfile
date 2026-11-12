FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY src/VisorDatosSIG.Web/VisorDatosSIG.Web.csproj src/VisorDatosSIG.Web/
RUN dotnet restore src/VisorDatosSIG.Web/VisorDatosSIG.Web.csproj

COPY src/ src/
RUN dotnet publish src/VisorDatosSIG.Web/VisorDatosSIG.Web.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
COPY claves/ /app/claves/

# Render inyecta PORT
ENV ASPNETCORE_URLS=http://+:${PORT:-10000}
ENV ASPNETCORE_ENVIRONMENT=Production

EXPOSE 10000
ENTRYPOINT ["dotnet", "VisorDatosSIG.Web.dll"]

