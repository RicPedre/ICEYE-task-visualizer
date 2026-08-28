import os
import json
import argparse
import pandas as pd
import xml.etree.ElementTree as ET

def parse_feasibility_data(excel_path=None, kml_path=None, aoi_name=None, output_json="acquisitions_data.json", output_js="data_embedded.js"):
    if not excel_path:
        excel_path = "CS-27201 Spot 23 Aug - 5 Sep_FeasibilityStudy.xlsx"
    if not kml_path:
        kml_path = "CS-27201 Spot 23 Aug - 5 Sep_FeasibilityStudy.kml"
        
    # Read Excel dataframe
    df = pd.read_excel(excel_path)
    
    # Read KML polygons mapping by Opportunity_ID if KML exists
    kml_polygons = {}
    if os.path.exists(kml_path):
        tree = ET.parse(kml_path)
        root = tree.getroot()
        ns = {'kml': 'http://www.opengis.net/kml/2.2'}
        
        for pm in root.findall('.//kml:Placemark', ns):
            ext_data = pm.find('kml:ExtendedData', ns)
            opp_id = None
            if ext_data is not None:
                for d in ext_data.findall('kml:Data', ns):
                    if d.attrib.get('name') == 'Opportunity_ID':
                        val = d.find('kml:value', ns)
                        if val is not None:
                            try:
                                opp_id = int(val.text)
                            except ValueError:
                                opp_id = val.text
                            break
            
            # Get polygon coordinates
            poly = pm.find('.//kml:Polygon//kml:coordinates', ns)
            if poly is not None and poly.text:
                raw_coords = poly.text.strip().split()
                ring = []
                for pt in raw_coords:
                    parts = pt.split(',')
                    if len(parts) >= 2:
                        lon, lat = float(parts[0]), float(parts[1])
                        ring.append([lon, lat])
                if opp_id is not None:
                    kml_polygons[opp_id] = ring
                    
    features = []
    opportunities = []
    
    min_lat, max_lat = 90.0, -90.0
    min_lon, max_lon = 180.0, -180.0
    
    combo_set = set()
    date_list = []
    
    for _, row in df.iterrows():
        opp_id = int(row['Opportunity_ID'])
        
        # Determine geometry polygon
        if opp_id in kml_polygons:
            coords = kml_polygons[opp_id]
        else:
            coords = [
                [float(row['NW_Lon']), float(row['NW_Lat'])],
                [float(row['NE_Lon']), float(row['NE_Lat'])],
                [float(row['SE_Lon']), float(row['SE_Lat'])],
                [float(row['SW_Lon']), float(row['SW_Lat'])],
                [float(row['NW_Lon']), float(row['NW_Lat'])]
            ]
            
        for pt in coords:
            min_lon = min(min_lon, pt[0])
            max_lon = max(max_lon, pt[0])
            min_lat = min(min_lat, pt[1])
            max_lat = max(max_lat, pt[1])
            
        dt_start = pd.to_datetime(row['Start'])
        dt_end = pd.to_datetime(row['End'])
        start_iso = dt_start.isoformat() + "Z"
        end_iso = dt_end.isoformat() + "Z"
        
        date_str = dt_start.strftime("%Y-%m-%d")
        date_list.append(date_str)
        
        sensor_str = str(row['Sensor'])
        pass_str = str(row['Pass']).upper()
        
        look_dir = "OTHER"
        if "(LEFT)" in sensor_str.upper() or "LEFT" in sensor_str.upper():
            look_dir = "LEFT"
        elif "(RIGHT)" in sensor_str.upper() or "RIGHT" in sensor_str.upper():
            look_dir = "RIGHT"
            
        pass_look_combo = f"{pass_str} - {look_dir}"
        combo_set.add(pass_look_combo)
        
        opp_dict = {
            "id": opp_id,
            "region": str(row.get('Region', aoi_name or 'Target Region')),
            "constellation": str(row.get('Constellation', 'SAR')),
            "sensor": sensor_str,
            "look_direction": look_dir,
            "pass": pass_str,
            "pass_look_combo": pass_look_combo,
            "start": start_iso,
            "end": end_iso,
            "date": date_str,
            "duration": int(row.get('Duration', 0)),
            "scenes": int(row.get('NumberOfScenes', 1)),
            "orbit": int(row.get('Orbit', 0)),
            "center_lat": round(float(row['Center_Lat']), 5),
            "center_lon": round(float(row['Center_Lon']), 5),
            "area_covered_pct": round(float(row['AreaCovered']), 2),
            "target_in_image_km2": round(float(row['TargetInImage']), 2),
            "polarization": str(row.get('Polarization', 'VV')),
            "oza": round(float(row.get('OZA', 0)), 2),
            "sza": round(float(row.get('SZA', 0)), 2),
            "look_angle": round(float(row.get('LookAngle', 0)), 2),
            "azimuth": round(float(row.get('Azimuth', 0)), 2),
            "min_incid": round(float(row.get('Min_Incid', 0)), 2),
            "max_incid": round(float(row.get('Max_Incid', 0)), 2),
            "coordinates": coords
        }
        
        opportunities.append(opp_dict)
        
        feature = {
            "type": "Feature",
            "id": opp_id,
            "properties": opp_dict,
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords]
            }
        }
        features.append(feature)
        
    # Auto-calculate AOI polygon if not specified (bounding box envelope)
    aoi_polygon = [
        [round(min_lon, 5), round(min_lat, 5)],
        [round(max_lon, 5), round(min_lat, 5)],
        [round(max_lon, 5), round(max_lat, 5)],
        [round(min_lon, 5), round(max_lat, 5)],
        [round(min_lon, 5), round(min_lat, 5)]
    ]

    final_aoi_name = aoi_name if aoi_name else "Aletsch Glacier Region" if "Aletsch" in excel_path or "CS-27201" in excel_path else "Campaign Region"

    output_data = {
        "metadata": {
            "total_count": len(opportunities),
            "aoi_name": final_aoi_name,
            "aoi_polygon": aoi_polygon,
            "bounds": {
                "min_lat": round(min_lat, 4),
                "max_lat": round(max_lat, 4),
                "min_lon": round(min_lon, 4),
                "max_lon": round(max_lon, 4)
            },
            "sensor_types": sorted(list(set(df['Sensor'].astype(str)))),
            "pass_types": sorted(list(set(df['Pass'].astype(str)))),
            "look_directions": ["LEFT", "RIGHT"],
            "pass_look_combos": sorted(list(combo_set)),
            "unique_dates": sorted(list(set(date_list))),
            "polarizations": sorted(list(set(df['Polarization'].astype(str)))),
            "incid_range": [round(float(df['Min_Incid'].min()), 2), round(float(df['Max_Incid'].max()), 2)],
            "oza_range": [round(float(df['OZA'].min()), 2), round(float(df['OZA'].max()), 2)],
            "sza_range": [round(float(df['SZA'].min()), 2), round(float(df['SZA'].max()), 2)],
            "azimuth_range": [round(float(df['Azimuth'].min()), 2), round(float(df['Azimuth'].max()), 2)],
            "coverage_range": [round(float(df['AreaCovered'].min()), 2), round(float(df['AreaCovered'].max()), 2)],
            "date_range": [pd.to_datetime(df['Start'].min()).strftime("%Y-%m-%d"), pd.to_datetime(df['Start'].max()).strftime("%Y-%m-%d")]
        },
        "geojson": {
            "type": "FeatureCollection",
            "features": features
        },
        "opportunities": opportunities
    }
    
    with open(output_json, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)

    with open(output_js, "w", encoding="utf-8") as f:
        f.write("window.ACQUISITIONS_EMBEDDED_DATA = " + json.dumps(output_data) + ";\n")
        
    print(f"Successfully generated {output_json} & {output_js} for AOI '{final_aoi_name}' with {len(opportunities)} items.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parse Satellite Acquisition Feasibility Study Excel & KML data into JSON.")
    parser.add_argument("--excel", type=str, help="Path to input Excel (.xlsx) file")
    parser.add_argument("--kml", type=str, help="Path to input KML (.kml) file")
    parser.add_argument("--aoi-name", type=str, help="Name of the Area of Interest region")
    parser.add_argument("--output-json", type=str, default="acquisitions_data.json", help="Output JSON path")
    parser.add_argument("--output-js", type=str, default="data_embedded.js", help="Output JS path")
    args = parser.parse_args()

    parse_feasibility_data(
        excel_path=args.excel,
        kml_path=args.kml,
        aoi_name=args.aoi_name,
        output_json=args.output_json,
        output_js=args.output_js
    )
