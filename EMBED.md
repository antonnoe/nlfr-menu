# Embedcode voor de Ning-pagina `actueel-frankrijknieuws`

Plak onderstaande code in een **tekst/HTML-module** op de pagina
`https://www.nederlanders.fr/page/actueel-frankrijknieuws`. Dezelfde techniek als
het hoofdmenu: de pagina laadt via een iframe en meldt zijn eigen hoogte terug,
zodat er geen scrollbalk in het iframe verschijnt.

Vervang `https://nlfr-menu.vercel.app` alleen als de Vercel-URL anders is.

```html
<iframe
  id="nlfrActueel"
  src="https://nlfr-menu.vercel.app/actueel"
  style="width:100%;height:640px;border:0;overflow:hidden;"
  scrolling="no"
  title="Actueel — Frankrijknieuws"
  name="nlfrActueel"></iframe>
<script>
(function(){
  var f = document.getElementById('nlfrActueel');
  var ORIGIN = new URL(f.src).origin;
  window.addEventListener('message', function(e){
    if (e.origin !== ORIGIN) return;
    if (e.data && e.data.nlfrActueelHeight){
      f.style.height = (e.data.nlfrActueelHeight + 4) + 'px';
    }
  });
})();
</script>
```

## Hoe het werkt

- Het iframe wijst naar `…/actueel` (de route `actueel.html`, met `cleanUrls`).
- De pagina haalt zijn inhoud live op uit `/api/actueel` en
  `/api/schoolvakanties` en meldt na elke render zijn hoogte via
  `postMessage({ nlfrActueelHeight })`; het scriptje hierboven past de
  iframe-hoogte aan. Alleen berichten van de eigen Vercel-origin worden
  geaccepteerd.
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
