// ── dash_map.js — D3 choropleth map ─────────────────────────
// Freshket TL Dashboard v707
// GeoJSON: fetched lazily from geo/ folder

let BKK_GEO = null;
let SUR_GEO = null;

async function loadGeoJSON() {
  if (BKK_GEO && SUR_GEO) return true;  // already loaded
  try {
    const bkkResp = await fetch('/geo/bangkok_khet.geojson');
    if (!bkkResp.ok) throw new Error('bangkok_khet.geojson HTTP ' + bkkResp.status);
    BKK_GEO = await bkkResp.json();
    DashLog.info('map', 'BKK GeoJSON loaded');
  } catch(e) {
    DashLog.error('map_bkk_geojson', e.message);
    return false;
  }
  try {
    const surResp = await fetch('/geo/surrounding_provinces.geojson');
    if (!surResp.ok) throw new Error('surrounding_provinces.geojson HTTP ' + surResp.status);
    SUR_GEO = await surResp.json();
    DashLog.info('map', 'Surrounding GeoJSON loaded');
  } catch(e) {
    DashLog.error('map_sur_geojson', e.message);
    // Non-fatal — surrounding provinces are background only
    SUR_GEO = { type: 'FeatureCollection', features: [] };
  }
  return true;
}


// Mock district data until real CSV arrives (Phase 3)
const REAL_DISTRICT = {"บางบอน": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 3682273, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Dec 25": {"gmv": 3685058, "accounts": 21, "outlets": 42, "new_accounts": 0}, "Jan 26": {"gmv": 3508305, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Feb 26": {"gmv": 3327885, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Mar 26": {"gmv": 3530215, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Apr 26": {"gmv": 3432991, "accounts": 21, "outlets": 42, "new_accounts": 1}}}, "บางกะป": {"hub_zone": "Kaset-Nawamin", "hub_code": "Q", "months": {"Nov 25": {"gmv": 957661, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 947067, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 1009103, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 1034982, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 1059546, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 1006267, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "บางแค": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 4910735, "accounts": 26, "outlets": 52, "new_accounts": 1}, "Dec 25": {"gmv": 4999473, "accounts": 26, "outlets": 52, "new_accounts": 2}, "Jan 26": {"gmv": 5122164, "accounts": 26, "outlets": 52, "new_accounts": 0}, "Feb 26": {"gmv": 5439097, "accounts": 26, "outlets": 52, "new_accounts": 0}, "Mar 26": {"gmv": 5543056, "accounts": 26, "outlets": 52, "new_accounts": 0}, "Apr 26": {"gmv": 5512797, "accounts": 26, "outlets": 52, "new_accounts": 1}}}, "บางเขน": {"hub_zone": "Kaset-Nawamin", "hub_code": "Q", "months": {"Nov 25": {"gmv": 4221835, "accounts": 24, "outlets": 48, "new_accounts": 1}, "Dec 25": {"gmv": 4105348, "accounts": 24, "outlets": 48, "new_accounts": 0}, "Jan 26": {"gmv": 4144503, "accounts": 24, "outlets": 48, "new_accounts": 2}, "Feb 26": {"gmv": 4332600, "accounts": 24, "outlets": 48, "new_accounts": 1}, "Mar 26": {"gmv": 4148764, "accounts": 24, "outlets": 48, "new_accounts": 1}, "Apr 26": {"gmv": 4084668, "accounts": 24, "outlets": 48, "new_accounts": 1}}}, "บางคอแหลม": {"hub_zone": "Rama 3", "hub_code": "H", "months": {"Nov 25": {"gmv": 4434899, "accounts": 26, "outlets": 52, "new_accounts": 1}, "Dec 25": {"gmv": 4704580, "accounts": 26, "outlets": 52, "new_accounts": 2}, "Jan 26": {"gmv": 4727868, "accounts": 26, "outlets": 52, "new_accounts": 2}, "Feb 26": {"gmv": 4641011, "accounts": 26, "outlets": 52, "new_accounts": 2}, "Mar 26": {"gmv": 4508566, "accounts": 26, "outlets": 52, "new_accounts": 2}, "Apr 26": {"gmv": 4511190, "accounts": 26, "outlets": 52, "new_accounts": 1}}}, "บางนา": {"hub_zone": "Bang Na", "hub_code": "E", "months": {"Nov 25": {"gmv": 958187, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 994419, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 1009918, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 1065122, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 1127509, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 1197630, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "บางพลัด": {"hub_zone": "Taling Chan", "hub_code": "T", "months": {"Nov 25": {"gmv": 924431, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 878219, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 835114, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 875972, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 853526, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 895812, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "บางรัก": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 16895127, "accounts": 96, "outlets": 192, "new_accounts": 1}, "Dec 25": {"gmv": 17787878, "accounts": 96, "outlets": 192, "new_accounts": 6}, "Jan 26": {"gmv": 16853051, "accounts": 96, "outlets": 192, "new_accounts": 7}, "Feb 26": {"gmv": 17700638, "accounts": 96, "outlets": 192, "new_accounts": 3}, "Mar 26": {"gmv": 17944500, "accounts": 96, "outlets": 192, "new_accounts": 2}, "Apr 26": {"gmv": 18581396, "accounts": 96, "outlets": 192, "new_accounts": 5}}}, "บางซื่อ": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 1573776, "accounts": 9, "outlets": 18, "new_accounts": 0}, "Dec 25": {"gmv": 1592503, "accounts": 9, "outlets": 18, "new_accounts": 0}, "Jan 26": {"gmv": 1652136, "accounts": 9, "outlets": 18, "new_accounts": 0}, "Feb 26": {"gmv": 1644870, "accounts": 9, "outlets": 18, "new_accounts": 0}, "Mar 26": {"gmv": 1699279, "accounts": 9, "outlets": 18, "new_accounts": 0}, "Apr 26": {"gmv": 1762573, "accounts": 9, "outlets": 18, "new_accounts": 1}}}, "บางขุนเทียน": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 2285343, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Dec 25": {"gmv": 2366043, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Jan 26": {"gmv": 2348954, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Feb 26": {"gmv": 2274199, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Mar 26": {"gmv": 2183730, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Apr 26": {"gmv": 2089531, "accounts": 12, "outlets": 24, "new_accounts": 0}}}, "บางกอกน้อย": {"hub_zone": "Taling Chan", "hub_code": "T", "months": {"Nov 25": {"gmv": 184454, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Dec 25": {"gmv": 184872, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Jan 26": {"gmv": 188882, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Feb 26": {"gmv": 196445, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Mar 26": {"gmv": 200885, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Apr 26": {"gmv": 198874, "accounts": 1, "outlets": 2, "new_accounts": 0}}}, "บางกอกใหญ่": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 556468, "accounts": 3, "outlets": 6, "new_accounts": 0}, "Dec 25": {"gmv": 549096, "accounts": 3, "outlets": 6, "new_accounts": 0}, "Jan 26": {"gmv": 539357, "accounts": 3, "outlets": 6, "new_accounts": 0}, "Feb 26": {"gmv": 562289, "accounts": 3, "outlets": 6, "new_accounts": 0}, "Mar 26": {"gmv": 583471, "accounts": 3, "outlets": 6, "new_accounts": 0}, "Apr 26": {"gmv": 621427, "accounts": 3, "outlets": 6, "new_accounts": 0}}}, "บึงกุ่ม": {"hub_zone": "Kaset-Nawamin", "hub_code": "Q", "months": {"Nov 25": {"gmv": 2544985, "accounts": 14, "outlets": 28, "new_accounts": 0}, "Dec 25": {"gmv": 2441476, "accounts": 14, "outlets": 28, "new_accounts": 1}, "Jan 26": {"gmv": 2480819, "accounts": 14, "outlets": 28, "new_accounts": 0}, "Feb 26": {"gmv": 2540396, "accounts": 14, "outlets": 28, "new_accounts": 1}, "Mar 26": {"gmv": 2584927, "accounts": 14, "outlets": 28, "new_accounts": 1}, "Apr 26": {"gmv": 2652711, "accounts": 14, "outlets": 28, "new_accounts": 1}}}, "จตุจักร": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 10310636, "accounts": 60, "outlets": 120, "new_accounts": 1}, "Dec 25": {"gmv": 10910729, "accounts": 60, "outlets": 120, "new_accounts": 4}, "Jan 26": {"gmv": 10564022, "accounts": 60, "outlets": 120, "new_accounts": 0}, "Feb 26": {"gmv": 10557784, "accounts": 60, "outlets": 120, "new_accounts": 4}, "Mar 26": {"gmv": 10477224, "accounts": 60, "outlets": 120, "new_accounts": 4}, "Apr 26": {"gmv": 10884245, "accounts": 60, "outlets": 120, "new_accounts": 1}}}, "จอมทอง": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 948930, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 1011001, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 972959, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 972382, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 945307, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 923798, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "ดินแดง": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 3296143, "accounts": 18, "outlets": 36, "new_accounts": 0}, "Dec 25": {"gmv": 3275874, "accounts": 18, "outlets": 36, "new_accounts": 1}, "Jan 26": {"gmv": 3441933, "accounts": 18, "outlets": 36, "new_accounts": 1}, "Feb 26": {"gmv": 3494759, "accounts": 18, "outlets": 36, "new_accounts": 0}, "Mar 26": {"gmv": 3363930, "accounts": 18, "outlets": 36, "new_accounts": 1}, "Apr 26": {"gmv": 3190985, "accounts": 18, "outlets": 36, "new_accounts": 1}}}, "ดอนเมือง": {"hub_zone": "Don Mueang", "hub_code": "C", "months": {"Nov 25": {"gmv": 1062174, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Dec 25": {"gmv": 1114742, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Jan 26": {"gmv": 1086082, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Feb 26": {"gmv": 1081631, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Mar 26": {"gmv": 1128639, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Apr 26": {"gmv": 1185723, "accounts": 6, "outlets": 12, "new_accounts": 0}}}, "ดุสิต": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 171416, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Dec 25": {"gmv": 174936, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Jan 26": {"gmv": 170858, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Feb 26": {"gmv": 167791, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Mar 26": {"gmv": 171022, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Apr 26": {"gmv": 180990, "accounts": 1, "outlets": 2, "new_accounts": 0}}}, "ห้วยขวาง": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 2366159, "accounts": 13, "outlets": 26, "new_accounts": 0}, "Dec 25": {"gmv": 2419395, "accounts": 13, "outlets": 26, "new_accounts": 1}, "Jan 26": {"gmv": 2326617, "accounts": 13, "outlets": 26, "new_accounts": 1}, "Feb 26": {"gmv": 2269564, "accounts": 13, "outlets": 26, "new_accounts": 0}, "Mar 26": {"gmv": 2384724, "accounts": 13, "outlets": 26, "new_accounts": 0}, "Apr 26": {"gmv": 2409960, "accounts": 13, "outlets": 26, "new_accounts": 0}}}, "คันนายาว": {"hub_zone": "Khan Na Yao", "hub_code": "I", "months": {"Nov 25": {"gmv": 2591262, "accounts": 14, "outlets": 28, "new_accounts": 1}, "Dec 25": {"gmv": 2724680, "accounts": 14, "outlets": 28, "new_accounts": 0}, "Jan 26": {"gmv": 2744998, "accounts": 14, "outlets": 28, "new_accounts": 1}, "Feb 26": {"gmv": 2718533, "accounts": 14, "outlets": 28, "new_accounts": 1}, "Mar 26": {"gmv": 2663255, "accounts": 14, "outlets": 28, "new_accounts": 0}, "Apr 26": {"gmv": 2552586, "accounts": 14, "outlets": 28, "new_accounts": 0}}}, "คลองสามวา": {"hub_zone": "Khan Na Yao", "hub_code": "I", "months": {"Nov 25": {"gmv": 724735, "accounts": 4, "outlets": 8, "new_accounts": 0}, "Dec 25": {"gmv": 750650, "accounts": 4, "outlets": 8, "new_accounts": 0}, "Jan 26": {"gmv": 725024, "accounts": 4, "outlets": 8, "new_accounts": 0}, "Feb 26": {"gmv": 687909, "accounts": 4, "outlets": 8, "new_accounts": 0}, "Mar 26": {"gmv": 651847, "accounts": 4, "outlets": 8, "new_accounts": 0}, "Apr 26": {"gmv": 654986, "accounts": 4, "outlets": 8, "new_accounts": 0}}}, "คลองสาน": {"hub_zone": "Iconsiam", "hub_code": "Z", "months": {"Nov 25": {"gmv": 1124540, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Dec 25": {"gmv": 1071340, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Jan 26": {"gmv": 1134556, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Feb 26": {"gmv": 1207907, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Mar 26": {"gmv": 1288877, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Apr 26": {"gmv": 1324822, "accounts": 6, "outlets": 12, "new_accounts": 0}}}, "คลองเตย": {"hub_zone": "Ekkamai", "hub_code": "A", "months": {"Nov 25": {"gmv": 6996723, "accounts": 39, "outlets": 78, "new_accounts": 0}, "Dec 25": {"gmv": 7410915, "accounts": 39, "outlets": 78, "new_accounts": 0}, "Jan 26": {"gmv": 7899300, "accounts": 39, "outlets": 78, "new_accounts": 3}, "Feb 26": {"gmv": 8318557, "accounts": 39, "outlets": 78, "new_accounts": 0}, "Mar 26": {"gmv": 8293623, "accounts": 39, "outlets": 78, "new_accounts": 1}, "Apr 26": {"gmv": 8335406, "accounts": 39, "outlets": 78, "new_accounts": 0}}}, "หลักส": {"hub_zone": "Don Mueang", "hub_code": "C", "months": {"Nov 25": {"gmv": 931915, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 973304, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 933475, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 894056, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 889661, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 948969, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "ลาดกระบัง": {"hub_zone": "Khan Na Yao", "hub_code": "I", "months": {"Nov 25": {"gmv": 1486984, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Dec 25": {"gmv": 1541263, "accounts": 8, "outlets": 16, "new_accounts": 1}, "Jan 26": {"gmv": 1471131, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Feb 26": {"gmv": 1459988, "accounts": 8, "outlets": 16, "new_accounts": 1}, "Mar 26": {"gmv": 1513370, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Apr 26": {"gmv": 1439284, "accounts": 8, "outlets": 16, "new_accounts": 0}}}, "ลาดพร้าว": {"hub_zone": "Kaset-Nawamin", "hub_code": "Q", "months": {"Nov 25": {"gmv": 5332790, "accounts": 31, "outlets": 62, "new_accounts": 2}, "Dec 25": {"gmv": 5456387, "accounts": 31, "outlets": 62, "new_accounts": 0}, "Jan 26": {"gmv": 5442421, "accounts": 31, "outlets": 62, "new_accounts": 0}, "Feb 26": {"gmv": 5274641, "accounts": 31, "outlets": 62, "new_accounts": 1}, "Mar 26": {"gmv": 5250404, "accounts": 31, "outlets": 62, "new_accounts": 1}, "Apr 26": {"gmv": 5261628, "accounts": 31, "outlets": 62, "new_accounts": 2}}}, "มีนบุรี": {"hub_zone": "Khan Na Yao", "hub_code": "I", "months": {"Nov 25": {"gmv": 1282048, "accounts": 7, "outlets": 14, "new_accounts": 0}, "Dec 25": {"gmv": 1336552, "accounts": 7, "outlets": 14, "new_accounts": 0}, "Jan 26": {"gmv": 1278848, "accounts": 7, "outlets": 14, "new_accounts": 1}, "Feb 26": {"gmv": 1219926, "accounts": 7, "outlets": 14, "new_accounts": 0}, "Mar 26": {"gmv": 1250793, "accounts": 7, "outlets": 14, "new_accounts": 0}, "Apr 26": {"gmv": 1309250, "accounts": 7, "outlets": 14, "new_accounts": 0}}}, "หนองจอก": {"hub_zone": "Khan Na Yao", "hub_code": "I", "months": {"Nov 25": {"gmv": 186075, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Dec 25": {"gmv": 189163, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Jan 26": {"gmv": 200509, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Feb 26": {"gmv": 194371, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Mar 26": {"gmv": 185473, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Apr 26": {"gmv": 185129, "accounts": 1, "outlets": 2, "new_accounts": 0}}}, "หนองแขม": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 188820, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Dec 25": {"gmv": 197244, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Jan 26": {"gmv": 210136, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Feb 26": {"gmv": 208924, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Mar 26": {"gmv": 214990, "accounts": 1, "outlets": 2, "new_accounts": 0}, "Apr 26": {"gmv": 217725, "accounts": 1, "outlets": 2, "new_accounts": 0}}}, "ปทุมวัน": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 32575230, "accounts": 182, "outlets": 364, "new_accounts": 1}, "Dec 25": {"gmv": 33834115, "accounts": 182, "outlets": 364, "new_accounts": 13}, "Jan 26": {"gmv": 34165882, "accounts": 182, "outlets": 364, "new_accounts": 7}, "Feb 26": {"gmv": 32871400, "accounts": 182, "outlets": 364, "new_accounts": 11}, "Mar 26": {"gmv": 32768844, "accounts": 182, "outlets": 364, "new_accounts": 2}, "Apr 26": {"gmv": 32845495, "accounts": 182, "outlets": 364, "new_accounts": 7}}}, "ภาษีเจริญ": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 355135, "accounts": 2, "outlets": 4, "new_accounts": 0}, "Dec 25": {"gmv": 363542, "accounts": 2, "outlets": 4, "new_accounts": 0}, "Jan 26": {"gmv": 377188, "accounts": 2, "outlets": 4, "new_accounts": 0}, "Feb 26": {"gmv": 392791, "accounts": 2, "outlets": 4, "new_accounts": 0}, "Mar 26": {"gmv": 398309, "accounts": 2, "outlets": 4, "new_accounts": 0}, "Apr 26": {"gmv": 411244, "accounts": 2, "outlets": 4, "new_accounts": 0}}}, "พญาไท": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 5149004, "accounts": 29, "outlets": 58, "new_accounts": 2}, "Dec 25": {"gmv": 5130737, "accounts": 29, "outlets": 58, "new_accounts": 1}, "Jan 26": {"gmv": 5090557, "accounts": 29, "outlets": 58, "new_accounts": 1}, "Feb 26": {"gmv": 5079506, "accounts": 29, "outlets": 58, "new_accounts": 2}, "Mar 26": {"gmv": 4964599, "accounts": 29, "outlets": 58, "new_accounts": 2}, "Apr 26": {"gmv": 5092821, "accounts": 29, "outlets": 58, "new_accounts": 2}}}, "พระนคร": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 2049531, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Dec 25": {"gmv": 2153605, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Jan 26": {"gmv": 2109668, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Feb 26": {"gmv": 2040882, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Mar 26": {"gmv": 1964580, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Apr 26": {"gmv": 1996943, "accounts": 12, "outlets": 24, "new_accounts": 0}}}, "ป้อมปราบศัตรูพ่าย": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 1420640, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Dec 25": {"gmv": 1424142, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Jan 26": {"gmv": 1470147, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Feb 26": {"gmv": 1462608, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Mar 26": {"gmv": 1548923, "accounts": 8, "outlets": 16, "new_accounts": 0}, "Apr 26": {"gmv": 1508817, "accounts": 8, "outlets": 16, "new_accounts": 1}}}, "พระโขนง": {"hub_zone": "Ekkamai", "hub_code": "A", "months": {"Nov 25": {"gmv": 3867887, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Dec 25": {"gmv": 3804500, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Jan 26": {"gmv": 3985423, "accounts": 21, "outlets": 42, "new_accounts": 2}, "Feb 26": {"gmv": 4032304, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Mar 26": {"gmv": 4088515, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Apr 26": {"gmv": 4025275, "accounts": 21, "outlets": 42, "new_accounts": 0}}}, "ประเวศ": {"hub_zone": "Bang Na", "hub_code": "E", "months": {"Nov 25": {"gmv": 4104872, "accounts": 23, "outlets": 46, "new_accounts": 2}, "Dec 25": {"gmv": 4286960, "accounts": 23, "outlets": 46, "new_accounts": 1}, "Jan 26": {"gmv": 4133345, "accounts": 23, "outlets": 46, "new_accounts": 1}, "Feb 26": {"gmv": 4005564, "accounts": 23, "outlets": 46, "new_accounts": 2}, "Mar 26": {"gmv": 4212696, "accounts": 23, "outlets": 46, "new_accounts": 0}, "Apr 26": {"gmv": 4040694, "accounts": 23, "outlets": 46, "new_accounts": 2}}}, "ราษฎร์บูรณะ": {"hub_zone": "Rama 3", "hub_code": "H", "months": {"Nov 25": {"gmv": 2209331, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Dec 25": {"gmv": 2098136, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Jan 26": {"gmv": 2107561, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Feb 26": {"gmv": 2221747, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Mar 26": {"gmv": 2227282, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Apr 26": {"gmv": 2202099, "accounts": 12, "outlets": 24, "new_accounts": 0}}}, "ราชเทวี": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 872649, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 894988, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 879380, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 866255, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 878522, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 887412, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "สายไหม": {"hub_zone": "Don Mueang", "hub_code": "C", "months": {"Nov 25": {"gmv": 2015354, "accounts": 11, "outlets": 22, "new_accounts": 0}, "Dec 25": {"gmv": 1981785, "accounts": 11, "outlets": 22, "new_accounts": 1}, "Jan 26": {"gmv": 1966132, "accounts": 11, "outlets": 22, "new_accounts": 1}, "Feb 26": {"gmv": 2017257, "accounts": 11, "outlets": 22, "new_accounts": 1}, "Mar 26": {"gmv": 2077048, "accounts": 11, "outlets": 22, "new_accounts": 1}, "Apr 26": {"gmv": 2177875, "accounts": 11, "outlets": 22, "new_accounts": 0}}}, "สัมพันธวงศ์": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 2052823, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Dec 25": {"gmv": 2024636, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Jan 26": {"gmv": 2116850, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Feb 26": {"gmv": 2180665, "accounts": 12, "outlets": 24, "new_accounts": 0}, "Mar 26": {"gmv": 2099684, "accounts": 12, "outlets": 24, "new_accounts": 1}, "Apr 26": {"gmv": 2171958, "accounts": 12, "outlets": 24, "new_accounts": 0}}}, "สะพานสูง": {"hub_zone": "Khan Na Yao", "hub_code": "I", "months": {"Nov 25": {"gmv": 1917635, "accounts": 11, "outlets": 22, "new_accounts": 0}, "Dec 25": {"gmv": 1997575, "accounts": 11, "outlets": 22, "new_accounts": 0}, "Jan 26": {"gmv": 1904886, "accounts": 11, "outlets": 22, "new_accounts": 0}, "Feb 26": {"gmv": 1815596, "accounts": 11, "outlets": 22, "new_accounts": 0}, "Mar 26": {"gmv": 1736414, "accounts": 11, "outlets": 22, "new_accounts": 0}, "Apr 26": {"gmv": 1761038, "accounts": 11, "outlets": 22, "new_accounts": 0}}}, "สาทร": {"hub_zone": "Rama 3", "hub_code": "H", "months": {"Nov 25": {"gmv": 9831845, "accounts": 53, "outlets": 106, "new_accounts": 0}, "Dec 25": {"gmv": 9399755, "accounts": 53, "outlets": 106, "new_accounts": 2}, "Jan 26": {"gmv": 9749598, "accounts": 53, "outlets": 106, "new_accounts": 1}, "Feb 26": {"gmv": 10312560, "accounts": 53, "outlets": 106, "new_accounts": 0}, "Mar 26": {"gmv": 10478376, "accounts": 53, "outlets": 106, "new_accounts": 4}, "Apr 26": {"gmv": 10736373, "accounts": 53, "outlets": 106, "new_accounts": 4}}}, "สวนหลวง": {"hub_zone": "Bang Na", "hub_code": "E", "months": {"Nov 25": {"gmv": 3682423, "accounts": 21, "outlets": 42, "new_accounts": 2}, "Dec 25": {"gmv": 3603439, "accounts": 21, "outlets": 42, "new_accounts": 0}, "Jan 26": {"gmv": 3663584, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Feb 26": {"gmv": 3576199, "accounts": 21, "outlets": 42, "new_accounts": 0}, "Mar 26": {"gmv": 3703671, "accounts": 21, "outlets": 42, "new_accounts": 1}, "Apr 26": {"gmv": 3561963, "accounts": 21, "outlets": 42, "new_accounts": 1}}}, "ตลิ่งชัน": {"hub_zone": "Taling Chan", "hub_code": "T", "months": {"Nov 25": {"gmv": 1131660, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Dec 25": {"gmv": 1191390, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Jan 26": {"gmv": 1267309, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Feb 26": {"gmv": 1306035, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Mar 26": {"gmv": 1299862, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Apr 26": {"gmv": 1269140, "accounts": 6, "outlets": 12, "new_accounts": 0}}}, "ทวีวัฒนา)": {"hub_zone": "Taling Chan", "hub_code": "T", "months": {"Nov 25": {"gmv": 936730, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 935234, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 908371, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 929156, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 989023, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 1008427, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "ธนบุร": {"hub_zone": "Sathon", "hub_code": "B", "months": {"Nov 25": {"gmv": 872981, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Dec 25": {"gmv": 841220, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Jan 26": {"gmv": 819565, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Feb 26": {"gmv": 816175, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Mar 26": {"gmv": 816537, "accounts": 5, "outlets": 10, "new_accounts": 0}, "Apr 26": {"gmv": 821939, "accounts": 5, "outlets": 10, "new_accounts": 0}}}, "ทุ่งครุ": {"hub_zone": "Bang Khae", "hub_code": "G", "months": {"Nov 25": {"gmv": 1050215, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Dec 25": {"gmv": 1120697, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Jan 26": {"gmv": 1176416, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Feb 26": {"gmv": 1227903, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Mar 26": {"gmv": 1301393, "accounts": 6, "outlets": 12, "new_accounts": 0}, "Apr 26": {"gmv": 1341633, "accounts": 6, "outlets": 12, "new_accounts": 0}}}, "วังทองหลาง": {"hub_zone": "Lat Phrao", "hub_code": "D", "months": {"Nov 25": {"gmv": 1767382, "accounts": 10, "outlets": 20, "new_accounts": 0}, "Dec 25": {"gmv": 1744928, "accounts": 10, "outlets": 20, "new_accounts": 1}, "Jan 26": {"gmv": 1699152, "accounts": 10, "outlets": 20, "new_accounts": 1}, "Feb 26": {"gmv": 1650441, "accounts": 10, "outlets": 20, "new_accounts": 1}, "Mar 26": {"gmv": 1599971, "accounts": 10, "outlets": 20, "new_accounts": 1}, "Apr 26": {"gmv": 1643415, "accounts": 10, "outlets": 20, "new_accounts": 0}}}, "วัฒนา": {"hub_zone": "Ekkamai", "hub_code": "A", "months": {"Nov 25": {"gmv": 58861771, "accounts": 312, "outlets": 624, "new_accounts": 17}, "Dec 25": {"gmv": 60511572, "accounts": 312, "outlets": 624, "new_accounts": 15}, "Jan 26": {"gmv": 63976401, "accounts": 312, "outlets": 624, "new_accounts": 16}, "Feb 26": {"gmv": 67662946, "accounts": 312, "outlets": 624, "new_accounts": 7}, "Mar 26": {"gmv": 67228466, "accounts": 312, "outlets": 624, "new_accounts": 13}, "Apr 26": {"gmv": 63846549, "accounts": 312, "outlets": 624, "new_accounts": 13}}}, "ยานนาวา": {"hub_zone": "Rama 3", "hub_code": "H", "months": {"Nov 25": {"gmv": 7197428, "accounts": 39, "outlets": 78, "new_accounts": 0}, "Dec 25": {"gmv": 7428198, "accounts": 39, "outlets": 78, "new_accounts": 1}, "Jan 26": {"gmv": 7056985, "accounts": 39, "outlets": 78, "new_accounts": 3}, "Feb 26": {"gmv": 7095874, "accounts": 39, "outlets": 78, "new_accounts": 2}, "Mar 26": {"gmv": 7455346, "accounts": 39, "outlets": 78, "new_accounts": 2}, "Apr 26": {"gmv": 7186551, "accounts": 39, "outlets": 78, "new_accounts": 2}}}};


// ── Map state ─────────────────────────────────────────────────
let mapSvg, mapProjection, mapPath, mapZoomBehavior, mapG;
let mapScope = 'bkk';

const METRIC_LABELS = {
  gmv: 'GMV ฿', accounts: 'Accounts', outlets: 'Outlets', new_accounts: 'New Acc'
};

// ── Init ──────────────────────────────────────────────────────
async function initMap() {
  const ok = await loadGeoJSON();
  if (!ok) {
    const container = document.getElementById('map-container');
    if (container) container.innerHTML = errorPanel('map', 'โหลดแผนที่ไม่ได้ — กรุณา refresh');
    return;
  }
  const container = document.getElementById('map-container');
  const W = container.clientWidth  || 800;
  const H = container.clientHeight || 600;

  try {
  mapProjection = d3.geoMercator()
    .center([100.52, 13.75])
    .scale(W * 5.5)
    .translate([W/2, H/2]);

  mapPath = d3.geoPath().projection(mapProjection);

  mapZoomBehavior = d3.zoom()
    .scaleExtent([0.4, 14])
    .on('zoom', e => { mapG.attr('transform', e.transform); });

  mapSvg = d3.select('#map-svg').call(mapZoomBehavior);
  mapG   = mapSvg.append('g');

  // Surrounding (background)
  mapG.append('g').attr('class', 'g-sur')
    .selectAll('path').data(SUR_GEO.features).join('path')
    .attr('class','td-poly-bg').attr('d', mapPath);

  // Bangkok districts
  mapG.append('g').attr('class', 'g-bkk')
    .selectAll('path').data(BKK_GEO.features).join('path')
    .attr('class','td-poly')
    .attr('d', mapPath)
    .on('mousemove', onPolyHover)
    .on('mouseleave', onPolyLeave)
    .on('click', onPolyClick);

  updateMapColors();
  renderMapToolbar();
  renderMapLegend();
  if (DashState?.salesOverlay) renderSalesOverlay();
  } catch(mapErr) {
    DashLog.error('map_init', mapErr.message);
  }
}

// ── Colors ────────────────────────────────────────────────────
function getDistrictValue(nameTh) {
  const d = REAL_DISTRICT[nameTh];
  if (!d) return 0;
  return d.months[currentMonth]?.[currentMetric] || 0;
}

function updateMapColors() {
  if (!mapG) return;
  const values = BKK_GEO.features.map(f => getDistrictValue(f.properties.name_th));
  const max = d3.max(values) || 1;
  const min = d3.min(values.filter(v => v > 0)) || 0;

  // Read CSS vars for choropleth
  const cs = getComputedStyle(document.documentElement);
  const c0 = cs.getPropertyValue('--choro-0').trim();
  const c5 = cs.getPropertyValue('--choro-5').trim();

  const colorScale = d3.scaleSequential()
    .domain([min, max])
    .interpolator(d3.interpolateRgb(c0, c5));

  mapG.select('.g-bkk').selectAll('path')
    .transition().duration(300)
    .attr('fill', d => {
      const v = getDistrictValue(d.properties.name_th);
      return v > 0 ? colorScale(v) : '#F5F5F5';
    });

  // Update legend labels
  const fmtVal = currentMetric === 'gmv'
    ? v => fmtGMV(v)
    : v => fmtNum(Math.round(v));
  const legMin = document.getElementById('map-leg-min');
  const legMax = document.getElementById('map-leg-max');
  if (legMin) legMin.textContent = fmtVal(0);
  if (legMax) legMax.textContent = fmtVal(max);
}

// ── Toolbar ───────────────────────────────────────────────────
function renderMapToolbar() {
  const tb = document.getElementById('map-toolbar');
  if (!tb) return;
  tb.innerHTML = `
    <div class="ds-seg-ctrl">
      <button class="ds-seg-item active" onclick="setMapScope('bkk',this)">กรุงเทพฯ</button>
      <button class="ds-seg-item" onclick="setMapScope('metro',this)">กทม.+ปริมณฑล</button>
    </div>`;
}

function setMapScope(scope, btn) {
  mapScope = scope;
  document.querySelectorAll('#map-toolbar .ds-seg-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const container = document.getElementById('map-container');
  const W = container.clientWidth, H = container.clientHeight;
  if (scope === 'bkk') {
    mapProjection.center([100.52,13.75]).scale(W*5.5);
  } else {
    mapProjection.center([100.40,13.80]).scale(W*3.0);
  }
  mapPath = d3.geoPath().projection(mapProjection);
  mapSvg.call(mapZoomBehavior.transform, d3.zoomIdentity);
  mapG.selectAll('path').transition().duration(400).attr('d', mapPath);
}

// ── Legend ────────────────────────────────────────────────────
function renderMapLegend() {
  const leg = document.getElementById('map-legend');
  if (!leg) return;
  leg.innerHTML = `
    <div class="map-legend-title" id="map-leg-title">${METRIC_LABELS[currentMetric] || currentMetric}</div>
    <div class="map-legend-gradient"></div>
    <div class="map-legend-labels">
      <span id="map-leg-min">0</span>
      <span id="map-leg-max">—</span>
    </div>`;
}

// ── Hover ─────────────────────────────────────────────────────
function onPolyHover(event, d) {
  const name = d.properties.name_th;
  const dist = REAL_DISTRICT[name];
  const entry = dist?.months[currentMonth] || null;
  const prevM = MONTHS[MONTHS.indexOf(currentMonth)-1];
  const prev  = dist?.months[prevM];

  const tt = document.getElementById('map-tooltip');
  if (!entry) return;

  const delta = prev ? fmtDelta(entry[currentMetric], prev[currentMetric]) : '';
  const dcls  = prev ? deltaCls(entry[currentMetric], prev[currentMetric]) : '';

  tt.innerHTML = `
    <div class="tt-name">${name}</div>
    <div class="tt-zone">${dist.hub_zone || '—'}</div>
    <div class="tt-row"><span>GMV</span><span class="tt-val">${fmtGMV(entry.gmv)} ${delta ? `<span class="ds-delta ${dcls}">${delta}</span>` : ''}</span></div>
    <div class="tt-row"><span>Accounts</span><span class="tt-val">${fmtNum(entry.accounts)}</span></div>
    <div class="tt-row"><span>Outlets</span><span class="tt-val">${fmtNum(entry.outlets)}</span></div>`;

  const [mx,my] = d3.pointer(event, document.getElementById('map-container'));
  const aw = document.getElementById('map-container').clientWidth;
  const ah = document.getElementById('map-container').clientHeight;
  tt.style.left = (mx+14+170 > aw ? mx-174 : mx+14) + 'px';
  tt.style.top  = (my+14+110 > ah ? my-114 : my+14) + 'px';
  tt.classList.add('show');

  d3.select(event.target).style('opacity', '0.7');
}

function onPolyLeave(event) {
  document.getElementById('map-tooltip').classList.remove('show');
  if (!d3.select(event.target).classed('selected'))
    d3.select(event.target).style('opacity', null);
}

// ── Click ─────────────────────────────────────────────────────
function onPolyClick(event, d) {
  const name = d.properties.name_th;
  DashState.selectDistrict(name);
  if (!DashState.selectedDistrictName) {
    // was deselected — close detail
    closeDetail();
    return;
  }
  // Update polygon selected state
  mapG.select('.g-bkk').selectAll('path')
    .classed('selected', dd => dd.properties.name_th === name)
    .style('opacity', null);  // clear rep-dim when zone selected
  openDetailForDistrict(name, d.properties);
}

function openDetailForDistrict(name, props) {
  const dist  = REAL_DISTRICT[name];
  const entry = dist?.months[currentMonth] || {};
  const prevM = MONTHS[MONTHS.indexOf(currentMonth)-1];
  const prev  = dist?.months[prevM] || {};

  const delta = prev.gmv ? fmtDelta(entry.gmv, prev.gmv) : '';
  const dcls  = prev.gmv ? deltaCls(entry.gmv, prev.gmv) : '';

  // Sparkline
  const maxGMV = Math.max(...Object.values(dist?.months||{}).map(m=>m.gmv||0)) || 1;
  const sparks = MONTHS.map(m => {
    const v = dist?.months[m]?.gmv || 0;
    const h = Math.max(4, Math.round((v/maxGMV)*44));
    const cur = m === currentMonth;
    return `<div class="td-spark-bar${cur?' cur':''}" style="height:${h}px" title="${m}: ${fmtGMV(v)}"></div>`;
  }).join('');
  const sparkLabels = MONTHS.map(m =>
    `<span style="${m===currentMonth?'color:var(--ac)':''}">${m.split(' ')[0]}</span>`
  ).join('');

  // Mock accounts
  const mockAccounts = [
    { name:'ร้านอาหารสุขุมวิท', seg:'SA', status:'active', gmv:280000 },
    { name:'The Coffee Club', seg:'Chain', status:'active', gmv:420000 },
    { name:'Local Bistro', seg:'MC', status:'atrisk', gmv:95000 },
    { name:'Hotel Kitchen', seg:'Chain', status:'active', gmv:780000 },
    { name:'Mini Mart', seg:'SA', status:'inactive', gmv:12000 },
  ].slice(0, Math.max(2, Math.floor(Math.random()*5)+2));

  const accRows = mockAccounts.map(a => `
    <div class="td-acc-row">
      <div class="td-acc-dot ${a.status}"></div>
      <div class="td-acc-name">${a.name}</div>
      <span class="ds-seg-sa" style="flex-shrink:0">${a.seg}</span>
      <div class="td-acc-gmv">${fmtGMV(a.gmv)}</div>
    </div>`).join('');

  openDetail(`
    <div class="td-detail-hd">
      <div class="ds-eyebrow">${dist?.hub_zone || 'DISTRICT'}</div>
      <div class="td-detail-title">${name}</div>
      <div class="td-detail-sub">${props.name_en || ''} · กรุงเทพมหานคร</div>
    </div>
    <div class="td-detail-body">
      <div class="td-spark-wrap">
        <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">GMV 6 เดือน</div>
        <div class="td-spark">${sparks}</div>
        <div class="td-spark-labels" style="margin-top:3px">${sparkLabels}</div>
      </div>
      <div class="td-detail-section">
        <div class="ds-eyebrow" style="margin-bottom:var(--space-3)">Metrics · ${currentMonth}</div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">GMV</span>
          <span class="ds-stat-value">${fmtGMV(entry.gmv)} ${delta ? `<span class="ds-delta ${dcls}">${delta}</span>` : ''}</span>
        </div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">Active Accounts</span>
          <span class="ds-stat-value">${fmtNum(entry.accounts)}</span>
        </div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">Outlets</span>
          <span class="ds-stat-value">${fmtNum(entry.outlets)}</span>
        </div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">New Accounts (Sales)</span>
          <span class="ds-stat-value">${fmtNum(entry.new_accounts)}</span>
        </div>
      </div>
      <div class="td-detail-section">
        <div class="ds-eyebrow" style="margin-bottom:0">Accounts ใน District</div>
      </div>
      ${accRows}
    </div>`);
}

// ── Cancel pending init if nav away before timer fires ────────
function cancelMapInitTimer() {
  if (_mapInitTimer) { clearTimeout(_mapInitTimer); _mapInitTimer = null; }
}

// ── Zoom controls ──────────────────────────────────────────────
function mapZoom(factor) {
  if (!mapSvg) return;
  mapSvg.transition().duration(280).call(mapZoomBehavior.scaleBy, factor);
}
function mapReset() {
  if (!mapSvg) return;
  mapSvg.transition().duration(380).call(mapZoomBehavior.transform, d3.zoomIdentity);
}

// ── Boot: init map when map view becomes active ───────────────
function checkInitMap() {
  if (!mapG && document.getElementById('view-map')?.classList.contains('active')) {
    setTimeout(initMap, 0);
  }
}
// Called from setView override
const _origSetView = typeof setView === 'function' ? setView : null;

// Watch for map view — init on first show
let _mapInited = false;
let _mapInitTimer = null;
const _mapObserver = new MutationObserver(() => {
  const mapView = document.getElementById('view-map');
  if (mapView?.classList.contains('active') && !_mapInited) {
    _mapInited = true;  // flag set first to prevent double-trigger
    setTimeout(async () => { await initMap(); }, 60);
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const mapView = document.getElementById('view-map');
  if (mapView) {
    _mapObserver.observe(mapView, { attributes: true, attributeFilter: ['class'] });
    // If already active on load
    if (mapView.classList.contains('active')) {
      _mapInited = true;
      setTimeout(initMap, 80);
    }
  }
});


// ── Sales overlay (Phase 3) ───────────────────────────────────
function renderSalesOverlay() {
  // Remove existing overlay
  mapG?.selectAll('.td-sales-dot').remove();
  if (!DashState.salesOverlay || !mapG) return;

  // Mock: generate acquisition dots across Bangkok
  // Phase 2: replace with real first_dollar_date + lat/lng from R2
  const mockDots = BKK_GEO.features.flatMap(f => {
    const centroid = mapPath?.centroid(f);
    if (!centroid || isNaN(centroid[0])) return [];
    const dist = REAL_DISTRICT?.[f.properties.name_th];
    const count = dist?.months[currentMonth]?.new_accounts || 0;
    return Array.from({length: Math.min(count, 6)}, (_, i) => ({
      x: centroid[0] + (Math.random()-0.5) * 20,
      y: centroid[1] + (Math.random()-0.5) * 20,
      name: f.properties.name_th,
      gmv: Math.round(Math.random() * 200000 + 50000)
    }));
  });

  mapG.append('g').attr('class', 'td-sales-dot-group')
    .selectAll('circle').data(mockDots).join('circle')
    .attr('class', 'td-sales-dot')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', 5)
    .style('fill', 'var(--info)')
    .style('stroke', 'white')
    .style('stroke-width', '1.5')
    .style('opacity', '0')
    .style('cursor', 'pointer')
    .on('mousemove', (event, d) => {
      const tt = document.getElementById('map-tooltip');
      tt.innerHTML = `<div class="tt-name" style="color:var(--info)">New Account (Sales)</div>
        <div class="tt-zone">${d.name}</div>
        <div class="tt-row"><span>GMV</span><span class="tt-val">${fmtGMV(d.gmv)}</span></div>`;
      const [mx,my] = d3.pointer(event, document.getElementById('map-container'));
      tt.style.left = (mx+14) + 'px'; tt.style.top = (my+14) + 'px';
      tt.classList.add('show');
    })
    .on('mouseleave', () => document.getElementById('map-tooltip').classList.remove('show'))
    .transition().duration(300)
    .style('opacity', '0.85');
}

// Window resize
window.addEventListener('resize', () => {
  if (!_mapInited || !mapSvg) return;
  const container = document.getElementById('map-container');
  if (!container) return;
  const W = container.clientWidth, H = container.clientHeight;
  mapProjection.translate([W/2, H/2]);
  mapPath = d3.geoPath().projection(mapProjection);
  mapG.selectAll('path').attr('d', mapPath);
});
