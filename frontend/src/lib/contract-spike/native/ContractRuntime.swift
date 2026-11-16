// Handwritten helpers of the own generator's Swift output (spike #2342).
import Foundation

/// An int64 identifier that arrives as a JSON string or a JSON number.
public struct ContractID: Decodable, Hashable, Sendable, CustomStringConvertible {
    public let value: Int64
    public var description: String { String(value) }
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            guard let parsed = Int64(text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "invalid id \(text)")
            }
            value = parsed
        } else {
            value = try container.decode(Int64.self)
        }
    }
}

public struct Pagination: Decodable, Sendable {
    public let currentPage, pageSize, totalPages, totalRecords: Int
    enum CodingKeys: String, CodingKey {
        case currentPage = "current_page", pageSize = "page_size", totalPages = "total_pages", totalRecords = "total_records"
    }
}

public struct Success<T: Decodable & Sendable>: Decodable, Sendable {
    public let data: T
}

public struct Paginated<T: Decodable & Sendable>: Decodable, Sendable {
    public let data: T
    public let pagination: Pagination
}
