<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    exit(1);
}

$root = dirname(__DIR__);
$ajax = (string) file_get_contents($root . '/src/Engine/AvailabilityAjaxController.php');
$javascript = (string) file_get_contents($root . '/assets/js/booking-page.js');
$failures = [];

foreach ([
    "getLastAvailabilityFailureReason",
    "Availability could not be confirmed. Please try again.",
    "'availability_status' => \$availabilityStatus",
    "\$availabilityStatus = 'provider_unconfirmed';",
    "\$availabilityStatus = 'unavailable';",
    "\$rooms = \$availabilityProvider->getAvailableRooms(",
    "if (empty(\$rooms) && \$failureReason === 'provider_unconfirmed')",
] as $expected) {
    if (strpos($ajax, $expected) === false) {
        $failures[] = 'AJAX exact-room availability status is missing: ' . $expected;
    }
}

foreach ([
    "lastAvailabilityStatus: ''",
    "state.lastAvailabilityStatus = 'provider_unconfirmed';",
    'function setFixedRoomContinueState(nextState)',
    "submitButton.disabled = disabled;",
    "strings.retryAvailability || 'Retry Availability'",
    "strings.chooseOtherDates || 'Choose Other Dates'",
    "setFixedRoomContinueState(state.lastAvailabilityStatus === 'provider_unconfirmed' ? 'provider_unconfirmed' : 'unavailable');",
] as $expected) {
    if (strpos($javascript, $expected) === false) {
        $failures[] = 'Fixed-room UI failure-state handling is missing: ' . $expected;
    }
}

if ($failures) {
    echo "FAIL\n" . implode("\n", $failures) . "\n";
    exit(1);
}

echo "Exact-room availability UI state contract test passed.\n";
