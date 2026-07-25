<?php
/**
 * Thin base for table-backed models.
 *
 * Subclasses declare TABLE, FILLABLE (insert/update allowlist) and SORTABLE
 * (identifier allowlist for ORDER BY). Everything else is a prepared statement.
 */
abstract class Model
{
    protected const TABLE     = '';
    protected const PK        = 'id';
    protected const FILLABLE  = [];
    protected const SORTABLE  = ['id'];
    protected const SOFT_DELETE = false;

    public static function table(): string
    {
        return static::TABLE;
    }

    /**
     * Guard for dynamic ORDER BY. A column name reaching SQL from a query string
     * cannot be bound as a parameter, so it must be allowlisted instead.
     */
    protected static function assertSortable(?string $column, string $fallback = 'id'): string
    {
        if ($column !== null && in_array($column, static::SORTABLE, true)) {
            return $column;
        }
        return $fallback;
    }

    protected static function sortDirection(?string $dir): string
    {
        return strtolower((string) $dir) === 'asc' ? 'ASC' : 'DESC';
    }

    public static function find(int $id): ?array
    {
        $sql = 'SELECT * FROM `' . static::TABLE . '` WHERE `' . static::PK . '` = ?';
        if (static::SOFT_DELETE) {
            $sql .= ' AND is_deleted = 0';
        }
        return Database::fetch($sql . ' LIMIT 1', [$id]);
    }

    public static function findOrFail(int $id): array
    {
        $row = static::find($id);
        if ($row === null) {
            throw new NotFoundException(static::entityName() . ' not found');
        }
        return $row;
    }

    public static function exists(int $id): bool
    {
        $sql = 'SELECT 1 FROM `' . static::TABLE . '` WHERE `' . static::PK . '` = ?';
        if (static::SOFT_DELETE) {
            $sql .= ' AND is_deleted = 0';
        }
        return Database::scalar($sql . ' LIMIT 1', [$id]) !== null;
    }

    public static function create(array $data): int
    {
        $data = static::stampCreate($data);
        return Database::insert(static::TABLE, $data, array_merge(static::FILLABLE, ['created_by']));
    }

    public static function updateById(int $id, array $data): int
    {
        return Database::update(static::TABLE, $id, $data, static::FILLABLE, static::PK);
    }

    /** Masters soft-delete. Financial documents must use their own void() instead. */
    public static function softDelete(int $id): int
    {
        if (!static::SOFT_DELETE) {
            throw new LogicException(static::TABLE . ' does not support soft delete');
        }
        return Database::execute(
            'UPDATE `' . static::TABLE . '` SET is_deleted = 1, is_active = 0 WHERE `' . static::PK . '` = ?',
            [$id]
        );
    }

    protected static function stampCreate(array $data): array
    {
        if (!isset($data['created_by'])) {
            $uid = Request::userId();
            if ($uid !== null) {
                $data['created_by'] = $uid;
            }
        }
        return $data;
    }

    protected static function entityName(): string
    {
        return ucfirst(rtrim(str_replace('_', ' ', static::TABLE), 's'));
    }

    /**
     * Build a `WHERE` fragment from [sql => params] pairs.
     * @param array<int, array{0:string, 1:array}> $clauses
     * @return array{0:string, 1:array}
     */
    protected static function buildWhere(array $clauses): array
    {
        $sql = [];
        $params = [];
        foreach ($clauses as [$fragment, $bind]) {
            $sql[] = $fragment;
            foreach ($bind as $b) {
                $params[] = $b;
            }
        }
        return [$sql === [] ? '1=1' : implode(' AND ', $sql), $params];
    }
}

/** Thrown by models; translated to a 404 by Controller::run(). */
class NotFoundException extends RuntimeException {}

/** Thrown by validators; translated to a 422 by Controller::run(). */
class ValidationException extends RuntimeException
{
    public array $errors;

    public function __construct(array $errors, string $message = 'Validation failed')
    {
        parent::__construct($message);
        $this->errors = $errors;
    }
}

/** Thrown when a business rule (not a field format) is violated → 409. */
class BusinessRuleException extends RuntimeException {}
