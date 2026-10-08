import { describe, expect, it } from "vitest";
import { parseDdgLiteHtml } from "@/service/WebSearchService";

const HTML_FIXTURE = `
<html>
  <body>
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fospf%3Fx%3D1&amp;rut=abc" class='result-link'>Guía <b>OSPF</b> &amp; más</a>
    <td class='result-snippet'>Snippet &lt;uno&gt;</td>
    <a class="result-link" data-extra="x" href='//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Frouting&rut=def' rel="nofollow">Enrutamiento dinámico</a>
    <td class="result-snippet">Snippet &amp; dos</td>
  </body>
</html>
`;

const HTML_FIXTURE_WITH_PATROCINADO = `
<html>
  <body>
    <table>
      <tr class="result-sponsored">
        <td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_domain%3Dx" class='result-link'>Cisco packet tracer</a>
          (Sponsored link - <a href="https://duckduckgo.com/duckduckgo-help-pages/company/ads-by-microsoft-on-duckduckgo-private-search/" rel="nofollow" class="result-link">more info</a>)
        </td>
      </tr>
      <tr>
        <td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Funo&rut=1">Resultado orgánico uno</a></td>
      </tr>
      <tr>
        <td class='result-snippet'>Snippet orgánico uno</td>
      </tr>
      <tr>
        <td><a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdos&rut=2">Resultado orgánico dos</a></td>
      </tr>
      <tr>
        <td class="result-snippet">Snippet orgánico dos</td>
      </tr>
    </table>
  </body>
</html>
`;

const HTML_FIXTURE_ENLACE_DDG = `
<html>
  <body>
    <table>
      <tr>
        <td><a class="result-link" href="https://duckduckgo.com/duckduckgo-help-pages/company/ads-by-microsoft-on-duckduckgo-private-search/">Ayuda sobre anuncios</a></td>
      </tr>
      <tr>
        <td class="result-snippet">Snippet de ayuda</td>
      </tr>
      <tr>
        <td><a class="result-link" href="https://example.com/organico">Resultado orgánico</a></td>
      </tr>
      <tr>
        <td class="result-snippet">Snippet orgánico</td>
      </tr>
    </table>
  </body>
</html>
`;

describe("parseDdgLiteHtml", () => {
  it("extrae los dos resultados del fixture", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE, 10);

    expect(results).toHaveLength(2);
  });

  it("decodifica la URL real desde el parámetro uddg", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE, 10);

    expect(results[0].url).toBe("https://example.com/ospf?x=1");
    expect(results[1].url).toBe("https://example.org/routing");
  });

  it("elimina etiquetas HTML y decodifica entidades del título", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE, 10);

    expect(results[0].title).toBe("Guía OSPF & más");
    expect(results[1].title).toBe("Enrutamiento dinámico");
  });

  it("empareja cada enlace con el siguiente snippet y decodifica entidades", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE, 10);

    expect(results[0].snippet).toBe("Snippet <uno>");
    expect(results[1].snippet).toBe("Snippet & dos");
  });

  it("respeta el límite solicitado", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE, 1);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/ospf?x=1");
  });

  it("devuelve [] cuando el HTML está vacío", () => {
    expect(parseDdgLiteHtml("", 5)).toEqual([]);
  });

  it("devuelve [] cuando no hay resultados", () => {
    expect(parseDdgLiteHtml("<html><body>Sin coincidencias</body></html>", 5)).toEqual(
      [],
    );
  });

  it("usa el href tal cual cuando no existe el parámetro uddg", () => {
    const html = `<a class="result-link" href="https://example.net/directo">Directo</a><td class="result-snippet">Snippet directo</td>`;
    const results = parseDdgLiteHtml(html, 5);

    expect(results[0].url).toBe("https://example.net/directo");
  });

  it("excluye los resultados patrocinados de las filas result-sponsored", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE_WITH_PATROCINADO, 10);

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.url)).toEqual([
      "https://example.com/uno",
      "https://example.com/dos",
    ]);
  });

  it("no cuenta los patrocinados para el límite solicitado", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE_WITH_PATROCINADO, 2);

    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://example.com/uno");
    expect(results[1].url).toBe("https://example.com/dos");
  });

  it("excluye enlaces del propio DuckDuckGo fuera de filas patrocinadas", () => {
    const results = parseDdgLiteHtml(HTML_FIXTURE_ENLACE_DDG, 10);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/organico");
    expect(results[0].title).toBe("Resultado orgánico");
  });
});
