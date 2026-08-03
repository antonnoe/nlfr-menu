# Embedcode voor de Ning-pagina `actueel-frankrijknieuws`

Plak onderstaande code in een **tekst/HTML-module** op de pagina
`https://www.nederlanders.fr/page/actueel-frankrijknieuws`. Het iframe is een
vaste-hoogte paneel: de knoppenbalk staat vastgepind en de inhoud scrollt
eronder (interne scrollbalk). De moederpagina geeft zijn vensterhoogte door,
zodat het paneel zo hoog mogelijk is zónder dat de knoppenbalk uit beeld valt.

> Belangrijk: gebruik **geen** `scrolling="no"` — dat blokkeert de interne
> scrollbalk waardoor lange inhoud wordt afgekapt.

Vervang `https://nlfr-menu.vercel.app` alleen als de Vercel-URL anders is.

```html
<iframe
  id="nlfrActueel"
  src="https://nlfr-menu.vercel.app/actueel"
  style="width:100%;height:640px;border:0;"
  title="Actueel — Frankrijknieuws"
  name="nlfrActueel"></iframe>
<script>
(function(){
  var f = document.getElementById('nlfrActueel');
  var ORIGIN = new URL(f.src).origin;
  function stuurVenster(){
    try { f.contentWindow.postMessage({ nlfrViewport: window.innerHeight }, ORIGIN); } catch (e) {}
  }
  window.addEventListener('message', function(e){
    if (e.origin !== ORIGIN) return;
    if (e.data && e.data.nlfrActueelHeight){
      f.style.height = (e.data.nlfrActueelHeight + 4) + 'px';
    }
  });
  f.addEventListener('load', stuurVenster);
  window.addEventListener('resize', stuurVenster);
  stuurVenster();
})();
</script>
```

## Hoe het werkt

- Het iframe wijst naar `…/actueel` (de route `actueel.html`, met `cleanUrls`).
- De pagina haalt zijn inhoud live op uit `/api/actueel` en
  `/api/schoolvakanties` en meldt via `postMessage({ nlfrActueelHeight })` hoe
  hoog het paneel moet zijn — gecapt op de vensterhoogte die de moederpagina
  doorgeeft met `postMessage({ nlfrViewport })`. Past de inhoud niet, dan scrollt
  hij intern terwijl de knoppenbalk vastgepind blijft. Alleen berichten van de
  eigen Vercel-origin worden geaccepteerd.
- Links in de feed openen met `target="_top"`, zodat ze de hele pagina openen en
  niet binnen het iframe blijven hangen.

## Beheer (reviewtool)

- Gepubliceerde redactiesyntheses verschijnen automatisch bovenaan de feed met
  het label *"Redactie NLFR — automatisch samengesteld, bronnen onderaan"*.
- Concepten worden nooit vanzelf live gezet. Beoordeel ze op
  `https://nlfr-menu.vercel.app/review?token=…` (het token is de Vercel-env-var
  `REVIEW_TOKEN`; deel de link niet publiek). De reviewtool is mobielvriendelijk:
  per concept de tekst + bronnenlijst met de knoppen **Publiceer** / **Weg** en
  inline tekst bewerken.
