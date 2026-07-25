<?php
/**
 * Route table + dispatcher.
 *
 * The 4th argument of every registration is the authorization guard, and it is
 * the whole authorization model:
 *
 *   false              public
 *   true               any authenticated user
 *   'staff'            any active staff user
 *   'staff:owner,ops'  staff whose staff_role is in the list
 *   'agent'            a B2B agency user (scoped to their own agency's data)
 *
 * Keeping this declarative means authorization is greppable, reviewable in a
 * diff, and testable as a plain map — see api/tests/authorization_test.php.
 */
class Router
{
    /** @var array<string, array<int, array{pattern:string, params:string[], handler:array, guard:mixed}>> */
    private array $routes = [
        'GET' => [], 'POST' => [], 'PUT' => [], 'PATCH' => [], 'DELETE' => [],
    ];

    public function get(string $path, array $handler, $guard = 'staff'): void    { $this->add('GET', $path, $handler, $guard); }
    public function post(string $path, array $handler, $guard = 'staff'): void   { $this->add('POST', $path, $handler, $guard); }
    public function put(string $path, array $handler, $guard = 'staff'): void    { $this->add('PUT', $path, $handler, $guard); }
    public function patch(string $path, array $handler, $guard = 'staff'): void  { $this->add('PATCH', $path, $handler, $guard); }
    public function delete(string $path, array $handler, $guard = 'staff'): void { $this->add('DELETE', $path, $handler, $guard); }

    private function add(string $method, string $path, array $handler, $guard): void
    {
        $params  = [];
        $pattern = preg_replace_callback('#\{([a-zA-Z_][a-zA-Z0-9_]*)\}#', static function ($m) use (&$params) {
            $params[] = $m[1];
            return '([^/]+)';
        }, '/' . trim($path, '/'));

        $this->routes[$method][] = [
            'pattern' => '#^' . $pattern . '$#',
            'params'  => $params,
            'handler' => $handler,
            'guard'   => $guard,
        ];
    }

    /** Full guard map, used by the authorization regression test. */
    public function guardMap(): array
    {
        $map = [];
        foreach ($this->routes as $method => $routes) {
            foreach ($routes as $r) {
                $map[$method . ' ' . $r['pattern']] = $r['guard'];
            }
        }
        return $map;
    }

    public function dispatch(): void
    {
        $method = Request::method();
        $path   = Request::path();

        foreach ($this->routes[$method] ?? [] as $route) {
            if (!preg_match($route['pattern'], $path, $m)) {
                continue;
            }

            array_shift($m);
            Request::setRouteParams(array_combine($route['params'], $m) ?: []);

            // Authorization runs before the controller is ever constructed.
            if (!AuthMiddleware::handle($route['guard'])) {
                return; // middleware already emitted 401/403
            }

            [$class, $action] = $route['handler'];
            if (!class_exists($class) || !method_exists($class, $action)) {
                Response::error('Route handler not implemented', 501);
                return;
            }

            (new $class())->$action();
            return;
        }

        // Distinguish "wrong verb" from "no such resource" — helps client debugging
        // without revealing anything a directory listing would not.
        $allowed = [];
        foreach ($this->routes as $verb => $routes) {
            if ($verb === $method) {
                continue;
            }
            foreach ($routes as $r) {
                if (preg_match($r['pattern'], $path)) {
                    $allowed[] = $verb;
                    break;
                }
            }
        }
        if ($allowed !== []) {
            header('Allow: ' . implode(', ', $allowed));
            Response::error('Method not allowed', 405);
            return;
        }

        Response::notFound('Endpoint not found');
    }
}
