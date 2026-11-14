"""Group-disjoint public partitions used for model training and benchmark extraction."""

from sklearn.model_selection import GroupShuffleSplit


def public_partitions(x, y, groups):
    development, test = next(
        GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42).split(x, y, groups)
    )
    fit, validation = next(
        GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=73).split(
            x[development], y[development], groups[development]
        )
    )
    return development[fit], development[validation], test
