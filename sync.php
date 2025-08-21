<?php
// Log all errors to a file
ini_set('display_errors', 0); // don't show in browser
ini_set('log_errors', 1);
error_reporting(E_ALL);
ini_set('error_log', __DIR__ . '/php-error.log'); // log file path

header("Content-Type: application/json");


// Decode input
$data = json_decode(file_get_contents("php://input"), true);

// Connect to PostgreSQL
$conn = pg_connect("host=localhost dbname=test_db user=postgres password=1234");
if (!$conn) {
    echo json_encode(["status" => "error", "message" => "❌ DB connection failed"]);
    exit;
}

// Insert records
foreach ($data['records'] as $rec) {
    $landuse_id = pg_escape_string($rec['landuse_id']);
    $crop = pg_escape_string($rec['crop']);
    $season = pg_escape_string($rec['season']);
    $area_ha = floatval($rec['area_ha']);
    $expected_yield = floatval($rec['expected_yield']);

    $sql = "INSERT INTO landuse.paddy (landuse_id, variety, season, area_ha, expected_yield)
            VALUES ('$landuse_id', '$crop', '$season', $area_ha, $expected_yield)
            ON CONFLICT DO NOTHING";

    $res = pg_query($conn, $sql);
    if (!$res) {
        echo json_encode(["status" => "error", "message" => pg_last_error($conn)]);
        exit;
    }
}

// Return success
echo json_encode(["status" => "ok"]);
