<?php
/**
 * Guest-facing vouchers.
 *
 * Issuing snapshots the document (see Voucher::issue); this controller is only
 * validation, batching and the audit-visible response.
 */
class VoucherController extends Controller
{
    /** GET /vouchers */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page();

            [$rows, $total] = Voucher::paginate([
                'search'       => Request::query('search'),
                'booking_id'   => Request::query('booking_id'),
                'voucher_type' => Request::query('voucher_type'),
                'supplier_id'  => Request::query('supplier_id'),
                'status'       => Request::query('status'),
                'from'         => Request::query('from'),
                'to'           => Request::query('to'),
            ], $limit, $offset, Request::query('sort'), Request::query('dir'));

            if (Exporter::maybeExport(Request::query('format'), $rows, [
                'voucher_no'          => 'Voucher No',
                'booking_no'          => 'Booking',
                'voucher_type'        => 'Type',
                'issued_to'           => 'Issued To',
                'supplier_name'       => 'Supplier',
                'service_description' => 'Service',
                'confirmation_no'     => 'Confirmation No',
                'valid_from'          => 'Valid From',
                'valid_to'            => 'Valid To',
                'status'              => 'Status',
                'issued_at'           => 'Issued At',
            ], 'vouchers')) {
                return;
            }

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** GET /vouchers/{id} */
    public function show(): void
    {
        $this->run(function () {
            $voucher = Voucher::detail(Request::paramInt('id'));
            if ($voucher === null) {
                Response::notFound('Voucher not found');
                return;
            }
            $this->assertAgencyAccess($voucher);

            Response::success($voucher);
        });
    }

    /** GET /bookings/{id}/vouchers */
    public function forBooking(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');
            Booking::findOrFail($bookingId);

            Response::success([
                'vouchers'         => Voucher::forBooking($bookingId),
                'pending_services' => Voucher::pendingServices($bookingId),
            ]);
        });
    }

    /** POST /bookings/{id}/vouchers  body {voucher_type, booking_service_id} */
    public function issue(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');

            $data = $this->validate(
                Request::only(['voucher_type', 'booking_service_id']),
                [
                    'voucher_type'       => 'nullable|in:' . implode(',', Voucher::TYPES),
                    'booking_service_id' => 'nullable|int|min:1',
                ]
            );

            // A voucher with neither a type nor a service line has nothing to say.
            if (empty($data['voucher_type']) && empty($data['booking_service_id'])) {
                throw new ValidationException([
                    'voucher_type' => ['Provide a voucher type, a service line, or both'],
                ]);
            }

            $id = Voucher::issue(
                $bookingId,
                $data['voucher_type'] ?? null,
                !empty($data['booking_service_id']) ? (int) $data['booking_service_id'] : null
            );

            Response::created(Voucher::detail($id), 'Voucher issued');
        });
    }

    /**
     * POST /bookings/{id}/vouchers/issue-all
     * One voucher per confirmed supplier service, skipping anything already
     * covered. Partial failures are reported rather than aborting the batch — a
     * single problem service must not block the other nine.
     */
    public function issueAll(): void
    {
        $this->run(function () {
            $bookingId = Request::paramInt('id');
            $booking   = Booking::findOrFail($bookingId);

            if ($booking['status'] === 'cancelled') {
                throw new BusinessRuleException('Vouchers cannot be issued against a cancelled booking');
            }
            if ($booking['status'] === 'draft') {
                throw new BusinessRuleException('Confirm the booking before issuing vouchers');
            }

            $pending = Voucher::pendingServices($bookingId);
            if ($pending === []) {
                Response::success([
                    'issued'   => [],
                    'skipped'  => [],
                    'vouchers' => Voucher::forBooking($bookingId),
                ], 'Every confirmed service already has a voucher');
                return;
            }

            $issued  = [];
            $skipped = [];

            foreach ($pending as $service) {
                try {
                    $id = Voucher::issue(
                        $bookingId,
                        Voucher::voucherTypeForService((string) $service['service_type']),
                        (int) $service['id']
                    );
                    $issued[] = Voucher::find($id);
                } catch (BusinessRuleException | ValidationException $e) {
                    $skipped[] = [
                        'booking_service_id' => (int) $service['id'],
                        'description'        => $service['description'],
                        'reason'             => $e->getMessage(),
                    ];
                }
            }

            Audit::log('vouchers_issued_batch', 'booking', $bookingId, null, [
                'issued_count' => count($issued), 'skipped_count' => count($skipped),
            ]);

            Response::created([
                'issued'   => $issued,
                'skipped'  => $skipped,
                'vouchers' => Voucher::forBooking($bookingId),
            ], count($issued) . ' voucher(s) issued');
        });
    }

    /** POST /vouchers/{id}/cancel  body {reason} */
    public function cancel(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');

            $data = $this->validate(Request::only(['reason']), ['reason' => 'required|string|max:255']);

            Voucher::cancel($id, $data['reason']);
            Response::success(Voucher::detail($id), 'Voucher cancelled');
        });
    }

    /** POST /vouchers/{id}/send — record that the guest has received it. */
    public function markSent(): void
    {
        $this->run(function () {
            $id = Request::paramInt('id');
            Voucher::markSent($id);
            Response::success(Voucher::detail($id), 'Voucher marked as sent');
        });
    }

    // -----------------------------------------------------------------------

    private function assertAgencyAccess(array $voucher): void
    {
        $user = Request::user();
        if ($user !== null && $user['user_type'] === 'agent'
            && (int) ($voucher['agency_id'] ?? 0) !== (int) $user['agency_id']) {
            throw new NotFoundException('Voucher not found');
        }
    }
}
