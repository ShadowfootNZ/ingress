#!/usr/bin/env python3
"""
Bannergress Mission Scraper - Working Version
Uses the actual Bannergress API to fetch banner and mission data.
"""

import json
import re
import sys
from typing import Optional, Dict
import requests


class BannergressScraper:
    """
    Scraper that uses the Bannergress API.
    API endpoint: https://api.bannergress.com/bnrs/{banner_id}
    """
    
    def __init__(self, url_or_id: str):
        if url_or_id.startswith('http'):
            self.banner_id = self._extract_banner_id(url_or_id)
            self.url = url_or_id
        else:
            self.banner_id = url_or_id
            self.url = f"https://bannergress.com/banner/{url_or_id}"
        
        self.data = None
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://bannergress.com/'
        })
    
    def _extract_banner_id(self, url: str) -> str:
        """Extract banner ID from URL"""
        # URL format: https://bannergress.com/banner/ingressfs-wellington-01-2026-7347
        # The full slug is the ID
        parts = url.rstrip('/').split('/')
        return parts[-1]
    
    def fetch_banner_data(self) -> Optional[Dict]:
        """Fetch banner data from Bannergress API"""
        endpoint = f'https://api.bannergress.com/bnrs/{self.banner_id}'
        
        try:
            print(f"Fetching from API: {endpoint}")
            response = self.session.get(endpoint, timeout=15)
            
            if response.status_code == 200:
                print(f"✓ Successfully fetched banner data")
                return response.json()
            elif response.status_code == 404:
                print(f"✗ Banner not found (404)")
                return None
            else:
                print(f"✗ API returned status code: {response.status_code}")
                return None
                
        except requests.RequestException as e:
            print(f"✗ Error fetching from API: {e}")
            return None
    
    def convert_api_response(self, api_data: Dict) -> Dict:
        """
        Convert Bannergress API response to the target mission data format.
        """
        
        output = {
            'missionSetName': api_data.get('title', ''),
            'missionSetDescription': api_data.get('description', ''),
            'currentMission': 0,
            'plannedBannerLength': api_data.get('numberOfMissions', 0),
            'titleFormat': 'T NN-M',
            'fileFormatVersion': 2,
            'missions': []
        }
        
        # The API returns missions as a dict with numeric string keys
        missions_dict = api_data.get('missions', {})
        
        # Sort by key to ensure correct order
        mission_keys = sorted(missions_dict.keys(), key=lambda x: int(x) if x.isdigit() else 0)
        
        for key in mission_keys:
            mission_api = missions_dict[key]
            
            mission = {
                'missionTitle': mission_api.get('title', ''),
                'missionDescription': mission_api.get('description', output['missionSetDescription']),
                'portals': []
            }
            
            # Get steps (which contain the POIs/portals)
            steps = mission_api.get('steps', [])
            
            for step in steps:
                poi = step.get('poi', {})
                objective = step.get('objective', 'hack')
                
                # Map objective type
                objective_type_map = {
                    'hack': 'HACK_PORTAL',
                    'capture': 'CAPTURE_PORTAL',
                    'upgrade': 'UPGRADE_PORTAL',
                    'photograph': 'PHOTOGRAPH_PORTAL',
                    'mod': 'MOD_PORTAL',
                    'link': 'LINK_PORTAL',
                    'field': 'FIELD_PORTAL'
                }
                
                portal = {
                    'description': '',
                    'guid': poi.get('id', ''),
                    'imageUrl': poi.get('picture', ''),
                    'isOrnamented': False,
                    'isStartPoint': False,
                    'location': {
                        'latitude': float(poi.get('latitude', 0)),
                        'longitude': float(poi.get('longitude', 0))
                    },
                    'title': poi.get('title', ''),
                    'type': poi.get('type', 'portal').upper(),
                    'objective': {
                        'type': objective_type_map.get(objective.lower(), 'HACK_PORTAL'),
                        'passphrase_params': {
                            'question': '',
                            '_single_passphrase': ''
                        }
                    }
                }
                
                mission['portals'].append(portal)
            
            output['missions'].append(mission)
        
        return output
    
    def scrape(self) -> Optional[Dict]:
        """Main scraping method"""
        print(f"Banner ID: {self.banner_id}")
        print(f"URL: {self.url}\n")
        
        api_data = self.fetch_banner_data()
        
        if not api_data:
            print("\nFailed to fetch banner data from API")
            return None
        
        print("Converting to target format...")
        self.data = self.convert_api_response(api_data)
        return self.data
    
    def save_json(self, output_file: Optional[str] = None) -> bool:
        """Save scraped data to JSON file"""
        if not self.data:
            print("No data to save")
            return False
        
        if not output_file:
            # Generate filename from banner name
            safe_name = re.sub(r'[^\w\s-]', '', self.data['missionSetName']).strip()
            safe_name = re.sub(r'[-\s]+', '_', safe_name)
            output_file = f"{safe_name}_mission-data.json"
        
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            print(f"\n✓ Saved to: {output_file}")
            return True
        except IOError as e:
            print(f"✗ Error saving file: {e}")
            return False
    
    def print_summary(self):
        """Print summary of extracted data"""
        if not self.data:
            return
        
        print("\n" + "="*70)
        print(f"Banner: {self.data['missionSetName']}")
        print(f"Description: {self.data['missionSetDescription']}")
        print(f"Total Missions: {len(self.data['missions'])}")
        print("="*70)
        
        for idx, mission in enumerate(self.data['missions'], 1):
            portals = len(mission['portals'])
            print(f"\n  Mission {idx}/{len(self.data['missions'])}: {mission['missionTitle']}")
            print(f"    Portals: {portals}")
            if portals > 0:
                print(f"    First portal: {mission['portals'][0]['title']}")
                if portals > 1:
                    print(f"    Last portal:  {mission['portals'][-1]['title']}")
        
        total = sum(len(m['portals']) for m in self.data['missions'])
        print(f"\n{'='*70}")
        print(f"Total portals across all missions: {total}")
        print("="*70)


def main():
    if len(sys.argv) < 2:
        print("Bannergress Mission Scraper")
        print("\nFetches mission data from Bannergress API and converts to JSON format")
        print("\nUsage:")
        print("  python bannergress_scraper_final.py <url_or_id> [output_file]")
        print("\nExamples:")
        print("  python bannergress_scraper_final.py https://bannergress.com/banner/ingressfs-wellington-01-2026-7347")
        print("  python bannergress_scraper_final.py ingressfs-wellington-01-2026-7347")
        print("  python bannergress_scraper_final.py ingressfs-wellington-01-2026-7347 output.json")
        sys.exit(1)
    
    url_or_id = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    scraper = BannergressScraper(url_or_id)
    
    try:
        data = scraper.scrape()
        
        if data:
            scraper.print_summary()
            if scraper.save_json(output_file):
                print("\n✓ Success! Mission data extracted and saved.")
            else:
                print("\n✗ Failed to save file")
                sys.exit(1)
        else:
            print("\n✗ Failed to fetch banner data")
            print("\nTroubleshooting:")
            print("  1. Verify the banner exists at: https://bannergress.com/banner/" + scraper.banner_id)
            print("  2. Check your internet connection")
            print("  3. The banner ID might be incorrect")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
