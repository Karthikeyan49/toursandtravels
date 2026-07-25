<?php
/**
 * Base controller. Provides the exception→HTTP translation every action shares,
 * plus validation and audit shortcuts.
 */
abstract class Controller
{
    /**
     * Wrap an action body. Domain exceptions become the right status code and a
     * safe message; anything unexpected is logged and returns a generic 500.
     */
    protected function run(callable $fn): void
    {
        try {
            $fn();
        } catch (ValidationException $e) {
            Response::validationFailed($e->errors, $e->getMessage());
        } catch (NotFoundException $e) {
            Response::notFound($e->getMessage());
        } catch (BusinessRuleException $e) {
            Response::error($e->getMessage(), 409);
        } catch (Throwable $e) {
            error_log(sprintf(
                '[error] %s: %s in %s:%d',
                get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()
            ));
            $debug = (Config::get('app.debug') === true);
            Response::error($debug ? $e->getMessage() : 'Internal server error', 500);
        }
    }

    /** @return array validated payload */
    protected function validate(array $data, array $rules): array
    {
        return Validator::make($data, $rules);
    }

    protected function userId(): ?int
    {
        return Request::userId();
    }

    protected function audit(string $action, string $entityType, ?int $entityId, ?array $old = null, ?array $new = null, ?string $note = null): void
    {
        Audit::log($action, $entityType, $entityId, $old, $new, $note);
    }

    /** Shorthand for list endpoints: [page, limit, offset]. */
    protected function page(int $default = 50, int $max = 200): array
    {
        return Request::pagination($default, $max);
    }
}
