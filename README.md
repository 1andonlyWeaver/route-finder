# route-finder

A sophisticated, interactive web-based visualizer for the A* pathfinding algorithm on real-world road networks. This tool allows users to find the optimal route between two addresses, with options to prioritize either the fastest time or the shortest distance.

## How to Run

Simply open the `index.html` file in a modern web browser that can run JavaScript.

## How It Works

The application is built within a single `index.html` file and leverages several key technologies:

- **Frontend:** The UI is built with Tailwind CSS for styling and Leaflet.js for interactive mapping.
- **Geocoding:** It uses the [Nominatim API](https://nominatim.openstreetmap.org/) to convert user-input addresses into latitude and longitude coordinates.
- **Road Network Data:** Real-world road data is fetched from the [Overpass API](https://overpass-api.de/), which provides raw OpenStreetMap data. The tool uses a Level of Detail (LOD) approach, querying for more detailed road types (including residential streets) around the start and end points, while focusing on major highways for the main route corridor. This makes long-distance searches feasible.
- **Graph Construction:** The fetched road data (nodes and ways) is used to construct a weighted graph in memory. Edge weights are calculated for both distance (Haversine distance) and time (based on road type, speed limits, and a simple congestion model).
- **A* Pathfinding:** The core pathfinding logic is implemented using the A* algorithm. To prevent the UI from freezing during complex calculations, the search runs in a separate Web Worker thread. The heuristic for the A* search is the Haversine distance to the destination.
- **Visualization:** The search process is visualized in real-time on the map, showing the "explored" nodes in red and the "frontier" nodes in orange. Once the destination is reached, the final optimal path is highlighted, and key metrics like total distance and estimated travel time are displayed.

## Key Features

- **Interactive Map:** Pan and zoom to explore the road network.
- **Customizable Routing:** Choose between finding the **Fastest Time** or the **Shortest Distance**.
- **Live Search Animation:** Watch the A* algorithm explore the road network in real-time.
- **Animation Control:** Adjust the animation speed, replay it, or cancel a running search.
- **Responsive UI:** The interface is designed to work on both desktop and mobile devices.
- **Robust Error Handling:** Includes fallbacks for API endpoints and an automatic retry with a larger map area if a path isn't found on the first attempt.
