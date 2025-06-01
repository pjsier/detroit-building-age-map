# TODO: Deploy to Cloudflare, R2
YEAR = 2025

tiles/raster/buildings-%.pmtiles: tiles/raster/buildings-%.mbtiles
	pmtiles convert $< $@

tiles/raster/buildings-%.mbtiles: tiles/raster/buildings/
	mb-util $</$* $@ --image_format=$*

tiles/raster/buildings/: input/buildings.geojson
	npm run render-tiles -- $<

tiles/vector/buildings.pmtiles: tiles/vector/buildings.mbtiles
	pmtiles convert $< $@

# TODO: set ID
tiles/vector/buildings.mbtiles: input/buildings.geojson
	tippecanoe \
		--simplification=10 \
		--simplify-only-low-zooms \
		--minimum-zoom=13 \
		--maximum-zoom=16 \
		--no-tile-stats \
		--detect-shared-borders \
		--grid-low-zooms \
		--coalesce-smallest-as-needed \
		--accumulate-attribute=age:mean \
		--attribute-type=parcel_id:string \
		--force \
		-L buildings:$< -o $@

input/buildings.geojson: input/raw-buildings.geojson input/parcels.csv
	npm run mapshapercli -- -i $< \
		-filter-fields parcel_id \
		-join $(filter-out $<,$^) keys=parcel_id,parcel_id field-types=parcel_id:str \
		-each 'age = year_built > 0 ? $(YEAR) - year_built : null' \
		-o $@

# TODO: fix
input/parcels.csv:
	esri2geojson https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0 - | \
		npm run mapshapercli -- -i - \
		-filter-fields parcel_id,address,year_built \
		-o $@

input/raw-buildings.geojson:
	esri2geojson https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/Base_Units_Buildings/FeatureServer/3 $@
