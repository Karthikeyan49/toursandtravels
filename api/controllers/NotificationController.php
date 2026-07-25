<?php
/**
 * The in-app inbox.
 *
 * A notification is addressed either to a specific user or to a role scope
 * (`role_scope = 'accounts'`), so a message about an overdue balance reaches
 * whoever is on accounts duty rather than one named person who may be on leave.
 * Every query here is bounded by the caller's own id and role — there is no way
 * to read another user's inbox.
 */
class NotificationController extends Controller
{
    /** GET /notifications?unread=1 */
    public function index(): void
    {
        $this->run(function () {
            [$page, $limit, $offset] = $this->page(30, 100);

            $userId = Request::userId();
            if ($userId === null) {
                Response::unauthorized();
                return;
            }

            [$rows, $total] = Notifier::inbox(
                $userId,
                Request::staffRole(),
                Request::queryBool('unread', false) === true,
                $limit,
                $offset
            );

            Response::paginated($rows, $page, $limit, $total);
        });
    }

    /** POST /notifications/{id}/read */
    public function markRead(): void
    {
        $this->run(function () {
            $id     = Request::paramInt('id');
            $userId = Request::userId();
            if ($userId === null) {
                Response::unauthorized();
                return;
            }

            // The WHERE clause is the authorization check: a notification that is
            // not addressed to this user simply does not match.
            $affected = Database::execute(
                'UPDATE notifications
                    SET read_at = NOW()
                  WHERE id = ?
                    AND read_at IS NULL
                    AND (user_id = ? OR (user_id IS NULL AND role_scope = ?))',
                [$id, $userId, Request::staffRole()]
            );

            if ($affected === 0) {
                // Either already read or not ours; both are a no-op, and saying
                // which would leak the existence of someone else's notification.
                Response::success(['id' => $id, 'read' => true], 'Notification already read');
                return;
            }

            Response::success(['id' => $id, 'read' => true], 'Marked as read');
        });
    }

    /** POST /notifications/read-all */
    public function markAllRead(): void
    {
        $this->run(function () {
            $userId = Request::userId();
            if ($userId === null) {
                Response::unauthorized();
                return;
            }

            $affected = Database::execute(
                'UPDATE notifications
                    SET read_at = NOW()
                  WHERE read_at IS NULL
                    AND (user_id = ? OR (user_id IS NULL AND role_scope = ?))',
                [$userId, Request::staffRole()]
            );

            Response::success(['marked' => $affected], $affected . ' notification(s) marked as read');
        });
    }

    /** GET /notifications/unread-count */
    public function unreadCount(): void
    {
        $this->run(function () {
            $userId = Request::userId();
            if ($userId === null) {
                Response::unauthorized();
                return;
            }
            $role = Request::staffRole();

            $bySeverity = Database::fetchAll(
                'SELECT severity, COUNT(*) AS unread
                   FROM notifications
                  WHERE read_at IS NULL AND (user_id = ? OR (user_id IS NULL AND role_scope = ?))
                  GROUP BY severity',
                [$userId, $role]
            );

            $counts = ['info' => 0, 'warning' => 0, 'critical' => 0];
            foreach ($bySeverity as $row) {
                $counts[$row['severity']] = (int) $row['unread'];
            }

            Response::success([
                'unread'      => array_sum($counts),
                'by_severity' => $counts,
            ]);
        });
    }
}
